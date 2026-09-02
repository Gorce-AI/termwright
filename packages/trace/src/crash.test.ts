import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { openTrace } from './reader.js';
import { generateHtmlReport } from './report.js';
import { TRACE_FILES, type TraceEvent } from './types.js';
import { createTraceWriter } from './writer.js';

const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-crash-'));
  temporaries.push(dir);
  return dir;
}

async function readEvents(dir: string): Promise<TraceEvent[]> {
  const text = await readFile(join(dir, TRACE_FILES.events), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceEvent);
}

/** Records a session whose program segfaults after printing a panic. */
async function recordCrash(dir: string, options: { idleTimeLimit?: number } = {}): Promise<void> {
  const session = new FakeSession('sess-crash');
  const writer = createTraceWriter(session, {
    dir,
    command: ['./server'],
    columns: 40,
    rows: 6,
    now: session.now,
    ...(options.idleTimeLimit === undefined ? {} : { idleTimeLimit: options.idleTimeLimit }),
  });

  session.semantic(snapshot(3, [node({ id: 'n1', role: 'button', name: 'Retry' })], 'sess-crash'));
  session.output('starting');
  const step = writer.addStep('boot the server');
  session.tick(200);
  session.output('\r\npanic: nil map');
  session.tick(50);
  session.crash({
    exit: { code: null, signal: 'SIGSEGV' },
    screenTail: ['starting', 'panic: nil map', 'goroutine 1 [running]:'],
    recentInputs: [
      { timeMs: 180, kind: 'key', bytes: 1, preview: 'r' },
      { timeMs: 190, kind: 'paste', bytes: 64 },
    ],
    diagnosticsTail: [
      { code: 'endpoint-error', detail: 'adapter socket closed', timeMs: 240 },
      { code: 'revision-dropped', detail: 'no marker for revision 4', revision: 4, timeMs: 245 },
    ],
  });
  step.end('failed', 'server died');
  await writer.finalize();
}

describe('crash in the archive', () => {
  it('records the crash in meta.json', async () => {
    const root = await workspace();
    const dir = join(root, 'crash.twtrace');
    await recordCrash(dir);

    const trace = await openTrace(dir);
    try {
      const crash = trace.meta.crash;
      expect(crash).toBeDefined();
      expect(crash?.exit).toEqual({ code: null, signal: 'SIGSEGV' });
      expect(crash?.screenTail).toEqual(['starting', 'panic: nil map', 'goroutine 1 [running]:']);
      expect(crash?.lastSemanticRevision).toBe(3);
      expect(crash?.recentInputs).toHaveLength(2);
      expect(crash?.diagnosticsTail.map((entry) => entry.code)).toEqual([
        'endpoint-error',
        'revision-dropped',
      ]);
      // The exit that follows the crash is recorded as usual.
      expect(trace.meta.exit).toEqual({ code: null, signal: 'SIGSEGV' });
    } finally {
      await trace.close();
    }
  });

  it('writes a crash entry in events.jsonl positioned on the cast timeline', async () => {
    const root = await workspace();
    const dir = join(root, 'events.twtrace');
    await recordCrash(dir);

    const events = await readEvents(dir);
    const crash = events.find((event) => event.kind === 'crash');
    expect(crash).toBeDefined();
    expect(crash).toMatchObject({
      kind: 'crash',
      t: 250,
      screenTailLines: 3,
      lastSemanticRevision: 3,
    });
    // It lands before the step that failed because of it.
    const kinds = events.map((event) => event.kind);
    expect(kinds.indexOf('crash')).toBeLessThan(kinds.lastIndexOf('step-end'));
  });

  it('maps the crash onto the trimmed cast timeline', async () => {
    const root = await workspace();
    const dir = join(root, 'trimmed.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now, idleTimeLimit: 2 });

    session.output('a');
    session.tick(30_000);
    session.output('b');
    session.crash({ exit: { code: 1, signal: null } });
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      // 30s of idle compresses to 2s, and the crash rides along with it.
      expect(trace.meta.crash?.t).toBe(30_000);
      expect(trace.meta.crash?.castOffset).toBe(2_000);
      expect(trace.meta.durationMs).toBe(2_000);
    } finally {
      await trace.close();
    }
  });

  it('resolves the crash tree out of semantics.jsonl', async () => {
    const root = await workspace();
    const dir = join(root, 'tree.twtrace');
    await recordCrash(dir);

    const trace = await openTrace(dir);
    try {
      const record = await trace.crashSemantic();
      expect(record?.revision).toBe(3);
      expect(record?.snapshot.nodes[0]?.name).toBe('Retry');
    } finally {
      await trace.close();
    }
  });

  it('leaves meta.crash absent for a clean exit', async () => {
    const root = await workspace();
    const dir = join(root, 'clean.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('done');
    session.exit(0);
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      expect(trace.meta.crash).toBeUndefined();
      expect(trace.meta.exit).toEqual({ code: 0, signal: null });
      expect(await trace.crashSemantic()).toBeNull();
      const events = await readEvents(dir);
      expect(events.some((event) => event.kind === 'crash')).toBe(false);
    } finally {
      await trace.close();
    }
  });
});

describe('crash in the HTML report', () => {
  it('shows how the program died, with the unredacted-screen warning', async () => {
    const root = await workspace();
    const dir = join(root, 'report.twtrace');
    await recordCrash(dir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'boots', status: 'failed', tracePath: dir }],
    });

    expect(html).toContain('<h3>Crash</h3>');
    expect(html).toContain('<strong>signal SIGSEGV</strong>');
    expect(html).toContain('goroutine 1 [running]:');
    expect(html).toContain('Not redacted');
    expect(html).toContain('secrets included');
    // Inputs: the key preview is shown, the paste's contents never are.
    expect(html).toContain('<code>r</code>');
    expect(html).toContain('64 B');
    expect(html).toContain('not recorded');
    expect(html).toContain('adapter socket closed');
    expect(html).toContain('Last semantic revision: 3');
  });

  it('reports an exit code when there was no signal', async () => {
    const root = await workspace();
    const dir = join(root, 'code.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('boom');
    session.crash({ exit: { code: 137, signal: null }, screenTail: ['out of memory'] });
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'oom', status: 'failed', tracePath: dir }],
    });
    expect(html).toContain('<strong>exit code 137</strong>');
    expect(html).toContain('out of memory');
  });

  it('escapes markup coming from the crashed program', async () => {
    const root = await workspace();
    const dir = join(root, 'xss.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.crash({
      exit: { code: 1, signal: null },
      screenTail: ['<script>alert(1)</script>'],
      recentInputs: [{ timeMs: 1, kind: 'raw', bytes: 5, preview: '<img>' }],
    });
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'hostile', status: 'failed', tracePath: dir }],
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;img&gt;');
  });

  it('omits the crash panel when nothing crashed', async () => {
    const root = await workspace();
    const dir = join(root, 'nocrash.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('fine');
    session.exit(0);
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'passes', status: 'failed', tracePath: dir }],
    });
    expect(html).not.toContain('<h3>Crash</h3>');
    expect(html).not.toContain('Not redacted');
  });
});

describe('a crash supplied without a trace', () => {
  it('renders the panel from ReportTestResult.crash alone', async () => {
    const root = await workspace();
    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        {
          id: 't1',
          title: 'no recording kept',
          status: 'failed',
          crash: {
            exit: { code: null, signal: 'SIGKILL' },
            timeMs: 4_200,
            screenTail: ['Killed'],
            recentInputs: [{ timeMs: 4_100, kind: 'paste', bytes: 12 }],
            diagnostics: [{ code: 'endpoint-error', detail: 'socket gone', timeMs: 4_150 }],
            lastSemanticRevision: 9,
          },
        },
      ],
    });

    expect(html).toContain('<strong>signal SIGKILL</strong>');
    expect(html).toContain('at 4.20s');
    expect(html).toContain('Killed');
    expect(html).toContain('Not redacted');
    expect(html).toContain('not recorded');
    expect(html).toContain('socket gone');
    expect(html).toContain('Last semantic revision: 9');
  });

  it('lets a supplied crash win over the one in the trace', async () => {
    const root = await workspace();
    const dir = join(root, 'both.twtrace');
    await recordCrash(dir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        {
          id: 't1',
          title: 'both',
          status: 'failed',
          tracePath: dir,
          crash: {
            exit: { code: 3, signal: null },
            timeMs: 1,
            screenTail: ['supplied by the caller'],
          },
        },
      ],
    });

    expect(html).toContain('supplied by the caller');
    expect(html).toContain('<strong>exit code 3</strong>');
    expect(html).not.toContain('goroutine 1 [running]:');
  });

  it('tolerates a crash with only the required fields', async () => {
    const root = await workspace();
    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        {
          id: 't1',
          title: 'bare',
          status: 'failed',
          crash: { exit: { code: 1, signal: null }, timeMs: 0, screenTail: [] },
        },
      ],
    });

    expect(html).toContain('<h3>Crash</h3>');
    expect(html).toContain('<strong>exit code 1</strong>');
    // No tail, no inputs, no diagnostics: the panel is just the cause line.
    expect(html).not.toContain('Screen at the end');
    expect(html).not.toContain('Last inputs before the end');
    expect(html).not.toContain('Not redacted');
  });
});
