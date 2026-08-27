import { describe, expect, it } from 'vitest';
import type { CrashReport } from '@termwright/driver';
import { permissionDialog } from './__fixtures__/tree.js';
import {
  REPORT_TAIL_LINES,
  appendCrashSection,
  collectCrashes,
  describeExit,
  formatCrashSection,
  toReportCrash,
  type CrashSource,
} from './crash.js';

function report(overrides: Partial<CrashReport> = {}): CrashReport {
  return {
    exit: { code: 1, signal: null },
    screenTail: ['CRASH APP READY', 'Error: boom from the fixture'],
    lastSemanticTree: null,
    recentInputs: [{ timeMs: 120, kind: 'key', bytes: 1, preview: 'x' }],
    diagnosticsTail: [{ code: 'listener-error', detail: 'adapter went away', timeMs: 118 }],
    timeMs: 121.6,
    ...overrides,
  } as CrashReport;
}

function source(crash: CrashReport | null, sessionId = 't1'): CrashSource {
  return { sessionId, crashReport: () => crash };
}

describe('describeExit', () => {
  it('names the signal, the code, or neither', () => {
    expect(describeExit({ code: null, signal: 'SIGKILL' })).toBe('killed by SIGKILL');
    expect(describeExit({ code: 2, signal: null })).toBe('exited with code 2');
    expect(describeExit({ code: null, signal: null })).toBe('exited for an unknown reason');
  });
});

describe('collectCrashes', () => {
  it('keeps only the sessions that crashed, with their trace', () => {
    const crashes = collectCrashes([
      { harness: source(null, 'alive') },
      { harness: source(report(), 'dead'), dir: 'out/dead.twtrace' },
    ]);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({
      index: 1,
      sessionId: 'dead',
      tracePath: 'out/dead.twtrace',
    });
  });

  it('is empty when nothing died', () => {
    expect(collectCrashes([{ harness: source(null) }])).toEqual([]);
  });
});

describe('formatCrashSection', () => {
  it('renders nothing when nothing crashed', () => {
    expect(formatCrashSection([])).toBe('');
  });

  it('leads with the cause and points at the trace', () => {
    const section = formatCrashSection(
      collectCrashes([{ harness: source(report()), dir: 'out/login.twtrace' }]),
    );
    expect(section).toContain('Process crashed');
    expect(section).toContain('exited with code 1 after 122ms');
    expect(section).toContain('Error: boom from the fixture');
    expect(section).toContain('last input: key "x" at 120ms');
    expect(section).toContain('last diagnostic: listener-error — adapter went away');
    expect(section).toContain('full trace: out/login.twtrace');
  });

  it('says so when there is no trace to point at', () => {
    const section = formatCrashSection(collectCrashes([{ harness: source(report()) }]));
    expect(section).toContain('no trace was recorded for this session (trace mode is off)');
  });

  it('shows the last 15 lines and says how many it dropped', () => {
    const tail = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
    const section = formatCrashSection(
      collectCrashes([{ harness: source(report({ screenTail: tail })) }]),
    );
    expect(section).toContain('screen tail (last 15 of 40 lines):');
    expect(section).toContain('    line 40');
    expect(section).toContain('    line 26');
    expect(section).not.toContain('    line 25');
  });

  it('omits the count when the whole tail fits', () => {
    const section = formatCrashSection(collectCrashes([{ harness: source(report()) }]));
    expect(section).toContain('screen tail:');
    expect(section).not.toContain('of 2 lines');
  });

  it('numbers the sessions only when several died', () => {
    const one = formatCrashSection(collectCrashes([{ harness: source(report(), 'solo') }]));
    expect(one).not.toContain('session 1');
    const many = formatCrashSection(
      collectCrashes([{ harness: source(report(), 'a') }, { harness: source(report(), 'b') }]),
    );
    expect(many).toContain('session 1 (a)');
    expect(many).toContain('session 2 (b)');
  });

  it('handles a report with nothing to show but the exit', () => {
    const bare = report({ screenTail: [], recentInputs: [], diagnosticsTail: [] });
    const section = formatCrashSection(collectCrashes([{ harness: source(bare) }]));
    expect(section).toContain('exited with code 1');
    expect(section).not.toContain('screen tail');
    expect(section).not.toContain('last input');
  });
});

describe('toReportCrash', () => {
  it('drops the semantic tree but keeps a pointer to its revision', () => {
    const payload = toReportCrash(report({ lastSemanticTree: permissionDialog() }));
    expect(payload).not.toHaveProperty('lastSemanticTree');
    expect(JSON.stringify(payload)).not.toContain('Permission');
    expect(payload.lastSemanticRevision).toBe(permissionDialog().revision);
  });

  it('says nothing about a revision for a session that never had a tree', () => {
    expect(toReportCrash(report({ lastSemanticTree: null }))).not.toHaveProperty(
      'lastSemanticRevision',
    );
  });

  it('keeps the revision a diagnostic is about', () => {
    const payload = toReportCrash(
      report({
        diagnosticsTail: [
          { code: 'protocol-violation', detail: 'bad frame', revision: 7, timeMs: 3 },
        ],
      }),
    );
    expect(payload.diagnostics?.[0]).toEqual({
      code: 'protocol-violation',
      detail: 'bad frame',
      revision: 7,
      timeMs: 3,
    });
  });

  it('bounds the screen tail for the trip between processes', () => {
    const tail = Array.from({ length: REPORT_TAIL_LINES + 50 }, (_, index) => `line ${index + 1}`);
    const payload = toReportCrash(report({ screenTail: tail }));
    expect(payload.screenTail).toHaveLength(REPORT_TAIL_LINES);
    expect(payload.screenTail.at(-1)).toBe(`line ${tail.length}`);
  });

  it('omits empty collections rather than sending empty arrays', () => {
    const payload = toReportCrash(report({ recentInputs: [], diagnosticsTail: [] }));
    expect(payload).toEqual({
      exit: { code: 1, signal: null },
      screenTail: ['CRASH APP READY', 'Error: boom from the fixture'],
      timeMs: 121.6,
    });
  });

  it('survives a round trip through JSON, which is how it reaches the reporter', () => {
    const payload = toReportCrash(report());
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe('appendCrashSection', () => {
  const crashes = collectCrashes([{ harness: source(report()), dir: 'out/x.twtrace' }]);

  it('appends to every error the runner recorded', () => {
    const errors = [{ message: 'expected true to be false' }, { message: 'second soft failure' }];
    expect(appendCrashSection(errors, crashes)).toBe(2);
    expect(errors[0]?.message).toMatch(/^expected true to be false\n\nProcess crashed/u);
    expect(errors[1]?.message).toContain('Process crashed');
  });

  it('does not append twice when a retry re-annotates the same error', () => {
    const errors = [{ message: 'boom' }];
    appendCrashSection(errors, crashes);
    const once = errors[0]?.message;
    expect(appendCrashSection(errors, crashes)).toBe(0);
    expect(errors[0]?.message).toBe(once);
  });

  it('tolerates an error with no message yet', () => {
    const errors: { message?: string }[] = [{}];
    expect(appendCrashSection(errors, crashes)).toBe(1);
    expect(errors[0]?.message).toContain('Process crashed');
  });

  it('reports that it annotated nothing when there are no errors to annotate', () => {
    // A timeout can fail a test before an error object exists; the crash still
    // reaches the report through task.meta.
    expect(appendCrashSection(undefined, crashes)).toBe(0);
    expect(appendCrashSection([], crashes)).toBe(0);
  });

  it('leaves errors alone when nothing crashed', () => {
    const errors = [{ message: 'plain assertion' }];
    expect(appendCrashSection(errors, [])).toBe(0);
    expect(errors[0]?.message).toBe('plain assertion');
  });
});
