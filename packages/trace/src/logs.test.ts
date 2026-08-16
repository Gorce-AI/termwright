import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packTrace } from './archive.js';
import { FakeSession } from './__fixtures__/fake-session.js';
import { openTrace } from './reader.js';
import { generateHtmlReport } from './report.js';
import { TRACE_FILES, type TraceLogEntry } from './types.js';
import { createTraceWriter } from './writer.js';

const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-logs-'));
  temporaries.push(dir);
  return dir;
}

/** A run whose failing step is accompanied by a warn and an error. */
async function recordWithLogs(dir: string): Promise<void> {
  const session = new FakeSession('sess-logs');
  const writer = createTraceWriter(session, { dir, columns: 40, rows: 6, now: session.now });

  session.output('booting');
  session.logRecord({ level: 'info', message: 'listening', logger: 'http' });
  const setup = writer.addStep('start the server');
  session.tick(100);
  setup.end('passed');

  const submit = writer.addStep('submit the form');
  session.tick(100);
  session.logRecord({
    level: 'warn',
    message: 'retrying upstream',
    logger: 'http',
    attrs: { attempt: 2, url: '/api/save' },
    revision: 7,
  });
  session.tick(50);
  session.logLine('2026-08-16T00:00:00Z ERROR db: connection refused', 'db.log');
  session.tick(50);
  session.logRecord({ level: 'error', message: 'save failed', logger: 'db', attrs: { code: 500 } });
  session.tick(50);
  submit.end('failed', 'save failed');
  await writer.finalize();
}

async function readLogFile(dir: string): Promise<TraceLogEntry[]> {
  const text = await readFile(join(dir, TRACE_FILES.logs), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceLogEntry);
}

describe('logs.jsonl', () => {
  it('records adapter records and file lines in one shape', async () => {
    const root = await workspace();
    const dir = join(root, 'logs.twtrace');
    await recordWithLogs(dir);

    const entries = await readLogFile(dir);
    expect(entries.map((entry) => entry.source)).toEqual([
      'adapter',
      'adapter',
      'file',
      'adapter',
    ]);

    const warn = entries[1];
    expect(warn).toMatchObject({
      source: 'adapter',
      level: 'warn',
      label: 'http',
      message: 'retrying upstream',
      attrs: { attempt: 2, url: '/api/save' },
      revision: 7,
      t: 200,
      castOffset: 200,
    });
    expect(warn?.seq).toBeGreaterThan(0);

    const line = entries[2];
    expect(line).toMatchObject({
      source: 'file',
      label: 'db.log',
      message: '2026-08-16T00:00:00Z ERROR db: connection refused',
    });
    // A followed file has no level to report, and none is invented.
    expect(line?.level).toBeUndefined();
    expect(line?.attrs).toBeUndefined();
  });

  it('summarises the log in meta.json', async () => {
    const root = await workspace();
    const dir = join(root, 'summary.twtrace');
    await recordWithLogs(dir);

    const trace = await openTrace(dir);
    try {
      expect(trace.meta.logs).toEqual({
        count: 4,
        dropped: 0,
        sources: ['http', 'db.log', 'db'],
        levels: { info: 1, warn: 1, error: 1 },
      });
    } finally {
      await trace.close();
    }
  });

  it('writes no logs.jsonl when the session produced no logs', async () => {
    const root = await workspace();
    const dir = join(root, 'quiet.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('silence');
    await writer.finalize();

    expect(await stat(join(dir, TRACE_FILES.logs)).catch(() => null)).toBeNull();
    const trace = await openTrace(dir);
    try {
      expect(trace.meta.logs).toBeUndefined();
      const entries = [];
      for await (const entry of trace.logs()) entries.push(entry);
      expect(entries).toEqual([]);
    } finally {
      await trace.close();
    }
  });

  it('evicts the oldest entries and counts them, even when a flood ends the session', async () => {
    const root = await workspace();
    const dir = join(root, 'flood.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now, maxLogEntries: 3 });

    for (let index = 0; index < 10; index += 1) {
      session.tick(1);
      session.logRecord({ level: 'info', message: `entry ${index}` });
    }
    // No further event of any kind: the drop count must still be right.
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      expect(trace.meta.logs).toMatchObject({ count: 3, dropped: 7 });
      const entries = await readLogFile(dir);
      // The end is what survives — that is where the failure lives.
      expect(entries.map((entry) => entry.message)).toEqual([
        'entry 7',
        'entry 8',
        'entry 9',
      ]);
    } finally {
      await trace.close();
    }
  });

  it('maps entries onto the trimmed cast timeline', async () => {
    const root = await workspace();
    const dir = join(root, 'trimmed.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.output('a');
    session.tick(20_000);
    session.logRecord({ level: 'error', message: 'after a long wait' });
    session.tick(20_000);
    session.output('b');
    await writer.finalize({ idleTimeLimit: 1 });

    const trace = await openTrace(dir);
    try {
      const entries = await readLogFile(dir);
      expect(entries[0]?.t).toBe(20_000);
      expect(entries[0]?.castOffset).toBe(500);
    } finally {
      await trace.close();
    }
  });

  it('survives a zip round trip', async () => {
    const root = await workspace();
    const dir = join(root, 'zipped.twtrace');
    await recordWithLogs(dir);
    const zipPath = join(root, 'zipped.zip');
    await packTrace(dir, zipPath);

    const trace = await openTrace(zipPath);
    try {
      expect(trace.meta.logs?.count).toBe(4);
      const entries = [];
      for await (const entry of trace.logs()) entries.push(entry);
      expect(entries.map((entry) => entry.message)).toEqual([
        'listening',
        'retrying upstream',
        '2026-08-16T00:00:00Z ERROR db: connection refused',
        'save failed',
      ]);
    } finally {
      await trace.close();
    }
  });
});

describe('stateAt log window', () => {
  it('returns the entries leading up to the moment', async () => {
    const root = await workspace();
    const dir = join(root, 'window.twtrace');
    await recordWithLogs(dir);

    const trace = await openTrace(dir);
    try {
      expect((await trace.stateAt(0)).logs.map((entry) => entry.message)).toEqual(['listening']);
      expect((await trace.stateAt(250)).logs.map((entry) => entry.message)).toEqual([
        'listening',
        'retrying upstream',
        '2026-08-16T00:00:00Z ERROR db: connection refused',
      ]);
    } finally {
      await trace.close();
    }
  });

  it('bounds the window and can be turned off', async () => {
    const root = await workspace();
    const dir = join(root, 'bounded.twtrace');
    await recordWithLogs(dir);

    const trace = await openTrace(dir);
    try {
      const limited = await trace.stateAt(10_000, { logWindow: 2 });
      expect(limited.logs.map((entry) => entry.message)).toEqual([
        '2026-08-16T00:00:00Z ERROR db: connection refused',
        'save failed',
      ]);
      expect((await trace.stateAt(10_000, { logWindow: 0 })).logs).toEqual([]);
    } finally {
      await trace.close();
    }
  });

  it('returns an empty window for a session with no logs', async () => {
    const root = await workspace();
    const dir = join(root, 'nologs.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('x');
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      expect((await trace.stateAt(0)).logs).toEqual([]);
    } finally {
      await trace.close();
    }
  });
});

describe('logs in the HTML report', () => {
  it('shows the entries around the failure, level-coloured', async () => {
    const root = await workspace();
    const dir = join(root, 'report.twtrace');
    await recordWithLogs(dir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'submits', status: 'failed', tracePath: dir }],
    });

    expect(html).toContain('<h3>Application logs');
    expect(html).toContain('tw-log-warn');
    expect(html).toContain('tw-log-error');
    expect(html).toContain('retrying upstream');
    expect(html).toContain('save failed');
    // Attributes ride along with the message.
    expect(html).toContain('attempt=2 url=/api/save');
    // The entry from before the failing step is not in the window.
    expect(html).not.toContain('>listening<');
  });

  it('pins notable entries onto the timeline next to the steps', async () => {
    const root = await workspace();
    const dir = join(root, 'timeline.twtrace');
    await recordWithLogs(dir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'submits', status: 'failed', tracePath: dir }],
    });

    expect(html).toContain('<h3>Timeline</h3>');
    const timeline = html.slice(html.indexOf('<h3>Timeline</h3>'));
    // Steps and warn/error logs interleaved by time; info stays out.
    expect(timeline).toContain('<td>start the server</td>');
    expect(timeline).toContain('<td>submit the form</td>');
    expect(timeline).toContain('retrying upstream');
    expect(timeline).toContain('save failed');
    expect(timeline).not.toContain('listening');
    // A followed file line carries no level, so it is never guessed into the
    // notable set — even one that spells ERROR in its text.
    expect(timeline).not.toContain('connection refused');
    expect(timeline.indexOf('start the server')).toBeLessThan(
      timeline.indexOf('retrying upstream'),
    );
  });

  it('escapes log text from the application', async () => {
    const root = await workspace();
    const dir = join(root, 'hostile.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    const step = writer.addStep('run');
    session.tick(10);
    session.logRecord({ level: 'error', message: '<script>alert(1)</script>' });
    step.end('failed', 'boom');
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'hostile', status: 'failed', tracePath: dir }],
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('keeps the timeline when a session has steps but no logs', async () => {
    const root = await workspace();
    const dir = join(root, 'stepsonly.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    writer.addStep('only step').end('passed');
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'quiet', status: 'failed', tracePath: dir }],
    });
    expect(html).toContain('<h3>Timeline</h3>');
    expect(html).toContain('only step');
    expect(html).not.toContain('<h3>Application logs');
  });
});
