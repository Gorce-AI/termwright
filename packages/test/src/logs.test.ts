import { describe, expect, it } from 'vitest';
import type { LogLevel, LogRecord } from '@termwright/protocol';
import type { SessionEventMap, SessionEventRecord, SessionEvents } from '@termwright/driver';
import {
  MAX_CAPTURED_LOGS,
  logThresholdFailure,
  atLeast,
  collectLogs,
  createLogCollection,
  describeLogThresholdFailure,
  formatLogEntry,
  logsFailingThreshold,
  logsOf,
  matchesLog,
  type CapturedLog,
} from './logs.js';

let nextSeq = 0;

/** A record with a fresh `seq`, the way an adapter mints them. */
function record(level: LogLevel, message: string, extra: Partial<LogRecord> = {}): CapturedLog {
  nextSeq += 1;
  return {
    source: 'adapter',
    sessionId: 's1',
    timeMs: 10,
    record: { ts: 1_700_000_000_000, level, message, seq: nextSeq, ...extra },
  };
}

function line(text: string, label?: string): CapturedLog {
  return {
    source: 'file',
    sessionId: 's1',
    timeMs: 10,
    line: text,
    ...(label === undefined ? {} : { label }),
  };
}

describe('createLogCollection', () => {
  it('keeps entries in order and hands them back', () => {
    const logs = createLogCollection();
    logs.push(record('info', 'first'));
    logs.push(line('second'));
    expect(logs.all().map((entry) => entry.record?.message ?? entry.line)).toEqual([
      'first',
      'second',
    ]);
  });

  it('counts a record once, however many times it arrives', () => {
    // `seq` is strictly increasing per session, so the pair identifies a
    // record: a session subscribed twice must not double an error count.
    const logs = createLogCollection();
    const entry = record('error', 'save failed');
    logs.push(entry);
    logs.push({ ...entry });
    expect(logs.all()).toHaveLength(1);
  });

  it('keeps records that only look alike', () => {
    const logs = createLogCollection();
    logs.push(record('error', 'save failed'));
    logs.push(record('error', 'save failed'));
    expect(logs.all()).toHaveLength(2);
  });

  it('separates sessions that share a sequence number', () => {
    const logs = createLogCollection();
    const first = record('info', 'hello');
    logs.push(first);
    logs.push({ ...first, sessionId: 'other-session' });
    expect(logs.all()).toHaveLength(2);
  });

  it('never deduplicates file lines, which carry no sequence', () => {
    const logs = createLogCollection();
    logs.push(line('same line'));
    logs.push(line('same line'));
    expect(logs.all()).toHaveLength(2);
  });

  it('forgets an evicted identity, so the guard cannot outgrow the entries', () => {
    const logs = createLogCollection();
    const first = record('info', 'oldest');
    logs.push(first);
    for (let index = 0; index < MAX_CAPTURED_LOGS; index += 1)
      logs.push(record('info', `filler ${index}`));
    expect(logs.dropped()).toBe(1);
    // The oldest entry is gone, so its identity is free again.
    logs.push(first);
    expect(logs.all().at(-1)?.record?.message).toBe('oldest');
  });

  it('clears what it captured', () => {
    const logs = createLogCollection();
    const entry = record('info', 'gone');
    logs.push(entry);
    logs.clear();
    expect(logs.all()).toEqual([]);
    expect(logs.dropped()).toBe(0);
    // The identity guard is cleared too, or a cleared collection could not
    // capture the same record again.
    logs.push(entry);
    expect(logs.all()).toHaveLength(1);
  });

  it('drops the oldest entries rather than growing without bound', () => {
    const logs = createLogCollection();
    for (let index = 0; index < MAX_CAPTURED_LOGS + 3; index += 1) {
      logs.push(record('info', `entry ${index}`));
    }
    expect(logs.all()).toHaveLength(MAX_CAPTURED_LOGS);
    expect(logs.dropped()).toBe(3);
    expect(logs.all()[0]?.record?.message).toBe('entry 3');
  });
});

describe('matchesLog', () => {
  const entry = record('warn', 'disk almost full', { logger: 'storage', attrs: { free: 12 } });

  it('narrows by level, exactly or as a set', () => {
    expect(matchesLog(entry, { level: 'warn' })).toBe(true);
    expect(matchesLog(entry, { level: 'error' })).toBe(false);
    expect(matchesLog(entry, { level: ['error', 'warn'] })).toBe(true);
  });

  it('narrows by severity threshold', () => {
    expect(matchesLog(entry, { minLevel: 'info' })).toBe(true);
    expect(matchesLog(entry, { minLevel: 'error' })).toBe(false);
  });

  it('narrows by source, label and logger', () => {
    expect(matchesLog(entry, { source: 'adapter' })).toBe(true);
    expect(matchesLog(entry, { source: 'file' })).toBe(false);
    expect(matchesLog(entry, { logger: 'storage' })).toBe(true);
    expect(matchesLog(line('boom', 'app'), { label: 'app' })).toBe(true);
  });

  it('matches a message by substring or pattern, in records and in file lines', () => {
    expect(matchesLog(entry, { message: 'almost' })).toBe(true);
    expect(matchesLog(entry, { message: /full$/u })).toBe(true);
    expect(matchesLog(entry, { message: 'nope' })).toBe(false);
    expect(matchesLog(line('ENOENT: config.toml'), { message: 'ENOENT' })).toBe(true);
  });

  it('never matches a level query against a file line, which has no level', () => {
    expect(matchesLog(line('error: something'), { level: 'error' })).toBe(false);
    expect(matchesLog(line('error: something'), { minLevel: 'warn' })).toBe(false);
  });

  it('requires every field of the query', () => {
    expect(matchesLog(entry, { level: 'warn', message: 'disk' })).toBe(true);
    expect(matchesLog(entry, { level: 'warn', message: 'network' })).toBe(false);
  });
});

describe('formatLogEntry', () => {
  it('leaves out the fields that change every run', () => {
    const text = formatLogEntry(
      record('error', 'save failed', { seq: 42, revision: 7, ts: Date.now() }),
    );
    expect(text).toBe('error save failed');
    expect(text).not.toContain('42');
  });

  it('names the logger and sorts the attributes', () => {
    const text = formatLogEntry(
      record('info', 'request', { logger: 'http', attrs: { status: 500, url: '/x' } }),
    );
    expect(text).toBe('info http: request status=500 url="/x"');
  });

  it('renders a file line, with its label when it has one', () => {
    expect(formatLogEntry(line('plain line'))).toBe('plain line');
    expect(formatLogEntry(line('plain line', 'app'))).toBe('[app] plain line');
  });
});

describe('text', () => {
  it('is a stable rendering a snapshot can hold', () => {
    const logs = createLogCollection();
    logs.push(record('info', 'starting', { seq: 1, ts: 1 }));
    logs.push(record('error', 'boom', { seq: 2, ts: 2, logger: 'db' }));
    expect(logs.text()).toBe(['info starting', 'error db: boom', ''].join('\n'));
    expect(logs.text({ level: 'error' })).toBe('error db: boom\n');
  });

  it('is empty when nothing matches', () => {
    expect(createLogCollection().text()).toBe('');
  });
});

describe('collectLogs', () => {
  /** Delivers to the listeners of one event only, the way the driver does. */
  function fakeHarness(): {
    harness: { sessionId: string; events: SessionEvents };
    emit: (event: 'app-log' | 'diagnostic', payload: unknown) => void;
  } {
    const listeners = new Map<string, ((payload: never) => void)[]>();
    const journalListeners = new Set<(record: SessionEventRecord) => void>();
    const journal: SessionEventRecord[] = [];
    let sequence = 0;
    const harness = {
      sessionId: 'session-9',
      events: {
        on: (event: string, callback: (payload: never) => void) => {
          const bucket = listeners.get(event) ?? [];
          bucket.push(callback);
          listeners.set(event, bucket);
          return () => {
            const index = bucket.indexOf(callback);
            if (index !== -1) bucket.splice(index, 1);
          };
        },
        checkpoint: () => sequence,
        subscribe: (
          options: { fromSequence: number },
          callback: (record: SessionEventRecord) => void,
        ) => {
          for (const record of journal) {
            if (record.sequence >= options.fromSequence) callback(record);
          }
          journalListeners.add(callback);
          return () => journalListeners.delete(callback);
        },
      } satisfies SessionEvents,
    };
    return {
      harness,
      emit: (event, payload) => {
        const record = { sequence: ++sequence, type: event, payload } as SessionEventRecord;
        journal.push(record);
        for (const listener of journalListeners) listener(record);
        for (const listener of listeners.get(event) ?? []) listener(payload as never);
      },
    };
  }

  it('replays application logs emitted before collection attaches', () => {
    const { harness, emit } = fakeHarness();
    emit('app-log', {
      source: 'file',
      timeMs: 1,
      line: 'startup',
    } satisfies SessionEventMap['app-log']);
    const { collection } = collectLogs(harness);
    expect(collection.all()).toEqual([
      expect.objectContaining({ sessionId: 'session-9', line: 'startup' }),
    ]);
  });

  it('tags entries with the session and finds them by harness', () => {
    const { harness, emit } = fakeHarness();
    const { collection, dispose } = collectLogs(harness);
    emit('app-log', {
      source: 'adapter',
      timeMs: 5,
      record: { ts: 1, level: 'info', message: 'hi', seq: 1 },
    });
    expect(collection.all()[0]?.sessionId).toBe('session-9');
    expect(logsOf(harness)).toBe(collection);
    dispose();
    expect(logsOf(harness)).toBeUndefined();
  });

  it('sums the records the session says never arrived, live', () => {
    const { harness, emit } = fakeHarness();
    const { collection, dispose } = collectLogs(harness);
    emit('diagnostic', {
      code: 'log-dropped',
      detail: 'the adapter dropped 4',
      count: 4,
      timeMs: 5,
    });
    emit('diagnostic', {
      code: 'log-dropped',
      detail: 'refused 2 over budget',
      count: 2,
      timeMs: 6,
    });
    emit('diagnostic', { code: 'listener-error', detail: 'unrelated', count: 9, timeMs: 7 });
    expect(collection.lostRecords()).toBe(6);
    // A diagnostic is not a log entry.
    expect(collection.all()).toEqual([]);
    dispose();
    emit('diagnostic', { code: 'log-dropped', detail: 'after dispose', count: 3, timeMs: 8 });
    expect(collection.lostRecords()).toBe(6);
  });

  it('does not count a refused duplicate as a loss', () => {
    // A duplicate carries no `count`: the record it repeated did arrive, so
    // nothing is missing and the evidence is not incomplete.
    const { harness, emit } = fakeHarness();
    const { collection } = collectLogs(harness);
    emit('diagnostic', {
      code: 'log-dropped',
      detail: 'refused a log record with seq 7',
      timeMs: 5,
    });
    expect(collection.lostRecords()).toBe(0);
  });

  it('stops capturing once disposed', () => {
    const { harness, emit } = fakeHarness();
    const { collection, dispose } = collectLogs(harness);
    dispose();
    emit('app-log', { source: 'file', timeMs: 5, line: 'after' });
    expect(collection.all()).toEqual([]);
  });

  it('survives the same session being pooled twice', () => {
    // The footgun this guards: calling collectLogs on a harness the fixtures
    // already subscribed. Both listeners fire, and without an identity the
    // failOnLogLevel threshold would report one error as two.
    const { harness, emit } = fakeHarness();
    const shared = createLogCollection();
    collectLogs(harness, shared);
    collectLogs(harness, shared);
    emit('app-log', {
      source: 'adapter',
      timeMs: 5,
      record: { ts: 1, level: 'error', message: 'save failed', seq: 1 },
    });
    expect(shared.all()).toHaveLength(1);
  });

  it('can pool several sessions into one collection', () => {
    const first = fakeHarness();
    const second = fakeHarness();
    const shared = createLogCollection();
    collectLogs(first.harness, shared);
    collectLogs(second.harness, shared);
    first.emit('app-log', { source: 'file', timeMs: 1, line: 'a' });
    second.emit('app-log', { source: 'file', timeMs: 2, line: 'b' });
    expect(shared.all().map((entry) => entry.line)).toEqual(['a', 'b']);
  });
});

describe('the failure threshold', () => {
  it('counts records at or above the threshold', () => {
    const entries = [record('info', 'fine'), record('error', 'bad'), record('fatal', 'worse')];
    expect(logsFailingThreshold(entries, 'error').map((entry) => entry.record?.message)).toEqual([
      'bad',
      'worse',
    ]);
    expect(atLeast('fatal', 'error')).toBe(true);
    expect(atLeast('warn', 'error')).toBe(false);
  });

  it('never counts a file line, which carries no level', () => {
    // The word "error" in a log line is not a severity, and failing on it
    // would fail tests on a URL containing the word.
    expect(logsFailingThreshold([line('error: not structured')], 'error')).toEqual([]);
  });

  it('says nothing when nothing crossed the threshold', () => {
    expect(describeLogThresholdFailure([record('warn', 'meh')], 'error')).toBeUndefined();
  });

  it('warns that the list may be incomplete when records were lost', () => {
    const message = describeLogThresholdFailure([record('error', 'save failed')], 'error', 3);
    expect(message).toContain('3 log records never reached this test');
    expect(message).toContain('may be incomplete');
    // Nothing lost, nothing to caveat.
    expect(describeLogThresholdFailure([record('error', 'x')], 'error', 0)).not.toContain(
      'never reached',
    );
  });

  it('refuses a clean certification when the only evidence is a log gap', () => {
    const message = describeLogThresholdFailure([], 'error', 3);
    expect(message).toContain('could prove the run clean');
    expect(message).toContain('complete correctness log stream');
  });

  it('lists the offenders and how to turn the check off', () => {
    const message = describeLogThresholdFailure(
      [record('error', 'save failed', { logger: 'db' }), record('fatal', 'gave up')],
      'error',
    );
    expect(message).toContain('the program logged 2 records at level error or above');
    expect(message).toContain('  error db: save failed');
    expect(message).toContain('  fatal gave up');
    expect(message).toContain('terminal.failOnLogLevel(false)');
    expect(message).toContain('defineTermwrightConfig({ failOnLogLevel: false })');
  });

  it('summarises a flood rather than printing all of it', () => {
    const entries = Array.from({ length: 25 }, (_, index) => record('error', `failure ${index}`));
    const message = describeLogThresholdFailure(entries, 'error') ?? '';
    expect(message).toContain('failure 0');
    expect(message).toContain('…and 15 more');
    expect(message).not.toContain('failure 20');
  });
});

describe('logThresholdFailure', () => {
  const offending = [record('error', 'save failed')];

  it('fails a passing test whose program logged past the threshold', () => {
    expect(logThresholdFailure(offending, 'error', false)).toContain('save failed');
  });

  it('stays quiet when the check is off', () => {
    expect(logThresholdFailure(offending, false, false)).toBeUndefined();
  });

  it('stays quiet when the test already failed', () => {
    // The assertion that failed is the story; a second failure buries it.
    expect(logThresholdFailure(offending, 'error', true)).toBeUndefined();
  });

  it('respects a threshold raised or lowered from the default', () => {
    const warning = [record('warn', 'disk almost full')];
    expect(logThresholdFailure(warning, 'error', false)).toBeUndefined();
    expect(logThresholdFailure(warning, 'warn', false)).toContain('disk almost full');
  });
});
