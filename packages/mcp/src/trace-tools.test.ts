/**
 * The replay tools against real `.twtrace` archives.
 *
 * Fixtures are recorded through the public `@termwright/trace` writer over a
 * hand-driven session, so the tests exercise the same archive layout a failing
 * test run produces — no hand-written meta.json, no stubbed reader.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTraceWriter, packTrace } from '@termwright/trace';
import type { SessionEventMap, SessionEventRecord, SessionEvents } from '@termwright/driver';
import type { SemanticSnapshot } from './model.js';
import { Client, connectClient } from './sdk-facade.js';
import { ERROR_META_KEY, serveInMemory } from './server.js';
import type { RunningServer } from './server.js';
import type { McpError } from './errors.js';
import { TraceStore } from './traces.js';

type Listener = (payload: never) => void;

/**
 * A session whose clock and events the test drives by hand. The trace writer
 * only needs `sessionId`, `events` and `semanticTree`, which is exactly what a
 * `TerminalHarness` exposes to it.
 */
class ScriptedSession {
  readonly sessionId = 'sess-1';
  clock = 0;
  #tree: SemanticSnapshot | null = null;
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  readonly #journalListeners = new Set<(record: SessionEventRecord) => void>();
  readonly #journal: SessionEventRecord[] = [];
  #sequence = 0;

  readonly now = (): number => this.clock;

  readonly events: SessionEvents = {
    on: <E extends keyof SessionEventMap>(
      event: E,
      callback: (payload: SessionEventMap[E]) => void,
    ): (() => void) => {
      const set = this.#listeners.get(event) ?? new Set<Listener>();
      set.add(callback as Listener);
      this.#listeners.set(event, set);
      return () => set.delete(callback as Listener);
    },
    checkpoint: () => this.#sequence,
    subscribe: (options, callback) => {
      for (const record of this.#journal) {
        if (record.sequence >= options.fromSequence) callback(record);
      }
      this.#journalListeners.add(callback);
      return () => this.#journalListeners.delete(callback);
    },
  };

  semanticTree(): SemanticSnapshot | null {
    return this.#tree;
  }

  tick(ms: number): void {
    this.clock += ms;
  }

  #emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    const record = { sequence: ++this.#sequence, type: event, payload } as SessionEventRecord;
    this.#journal.push(record);
    for (const listener of this.#journalListeners) listener(record);
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }

  output(text: string): void {
    this.#emit('output', { data: new TextEncoder().encode(text), timeMs: this.clock });
  }

  publish(tree: SemanticSnapshot): void {
    this.#tree = tree;
    this.#emit('semantic-revision', { revision: tree.revision, timeMs: this.clock, snapshot: tree });
  }

  exit(code: number): void {
    this.#emit('exit', { code, signal: null, timeMs: this.clock });
  }
}

function tree(revision: number, approveDisabled: boolean): SemanticSnapshot {
  const unknownGeometry = () => ({
    displayed: { status: 'unknown' as const, reason: 'awaiting-revision-pair' as const },
    intendedRect: { status: 'unknown' as const, reason: 'awaiting-revision-pair' as const },
    visibleRect: { status: 'unknown' as const, reason: 'awaiting-revision-pair' as const },
  });
  return {
    v: 2,
    sessionId: 'sess-1',
    revision,
    columns: 40,
    rows: 6,
    rootIds: ['n1'],
    nodes: [
      { id: 'n1', role: 'dialog', name: 'Permission', state: { modal: true }, geometry: unknownGeometry() },
      {
        id: 'n2',
        parentId: 'n1',
        role: 'button',
        name: 'Approve',
        state: approveDisabled ? { disabled: true } : { focused: true },
        geometry: unknownGeometry(),
      },
    ],
    coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
    hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
  };
}

const temporaries: string[] = [];
const running: RunningServer[] = [];

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'termwright-mcp-trace-'));
  temporaries.push(dir);
  return dir;
}

async function rewriteCommittedMember(path: string, name: string, body: string): Promise<void> {
  await writeFile(join(path, name), body, 'utf8');
  const commitPath = join(path, 'COMMITTED');
  const commit = JSON.parse(await readFile(commitPath, 'utf8')) as { v: 1; checksums: Record<string, string> };
  commit.checksums[name] = createHash('sha256').update(body).digest('hex');
  await writeFile(commitPath, `${JSON.stringify(commit)}\n`, 'utf8');
}

/** Adds a logs.jsonl to a recorded archive, the way the trace writer does. */
async function withLogs(path: string): Promise<string> {
  const entries = [
    { t: 500, castOffset: 500, source: 'file', label: 'app', message: 'INFO booted' },
    {
      t: 2_100,
      castOffset: 2_100,
      source: 'adapter',
      label: 'http',
      level: 'error',
      message: 'upstream refused the token',
      seq: 7,
    },
    { t: 2_600, castOffset: 2_600, source: 'file', label: 'app', message: 'INFO retrying' },
  ];
  await rewriteCommittedMember(path, 'logs.jsonl', `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const metaPath = join(path, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
  meta['logs'] = { count: entries.length, sources: ['app', 'http'] };
  await rewriteCommittedMember(path, 'meta.json', JSON.stringify(meta));
  return path;
}

/** Records a two-step session whose second step fails, and returns its path. */
async function recordSample(): Promise<string> {
  const path = join(await workspace(), 'sample.twtrace');
  const session = new ScriptedSession();
  const writer = createTraceWriter(session, {
    dir: path,
    command: ['node', 'app.js'],
    columns: 40,
    rows: 6,
    now: session.now,
  });

  session.publish(tree(1, false));
  session.output('[2J[HPermission required\r\n[Approve]\r\n');
  const first = writer.addStep('opens the dialog');
  session.tick(1_000);
  first.end('passed');

  const second = writer.addStep('approves the request');
  session.tick(1_000);
  session.publish(tree(2, true));
  session.output('[2J[HPermission required\r\nApprove is disabled\r\n');
  session.tick(500);
  second.end('failed', 'the button stayed disabled');
  session.exit(1);

  await writer.finalize();
  return path;
}

interface ContentPart {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

interface ToolResult {
  readonly isError: boolean;
  readonly text: string;
  readonly content: readonly ContentPart[];
  readonly data: Record<string, unknown>;
  readonly error: { kind: string; suggestion?: string } | undefined;
}

async function connectSession(): Promise<(name: string, args?: Record<string, unknown>) => Promise<ToolResult>> {
  const server = await serveInMemory();
  running.push(server);
  const client = new Client({ name: 'termwright-tests', version: '0.0.0' });
  await connectClient(client, server.clientTransport);
  return async (name, args = {}): Promise<ToolResult> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: ContentPart[];
      structuredContent?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };
    return {
      isError: result.isError === true,
      content: result.content ?? [],
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
      data: result.structuredContent ?? {},
      error: result._meta?.[ERROR_META_KEY] as ToolResult['error'],
    };
  };
}

describe('replaying a recorded failure', () => {
  it('opens an archive and reports what was recorded', async () => {
    const call = await connectSession();
    const opened = await call('trace.open', { path: await recordSample() });

    expect(opened.isError, opened.text).toBe(false);
    expect(opened.data['traceId']).toBe('tr1');
    expect(opened.data['steps']).toBe(2);
    const meta = opened.data['meta'] as { command: string[]; exit?: { code: number } };
    expect(meta.command).toEqual(['node', 'app.js']);
    expect(meta.exit?.code).toBe(1);
    expect(opened.text).toContain('semanticTree: available');
  });

  it('names the step that failed, with its error and window', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const overview = await call('trace.overview', { traceId: data['traceId'] });

    expect(overview.isError, overview.text).toBe(false);
    const failed = overview.data['failedSteps'] as { index: number; title: string; error: string }[];
    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('approves the request');
    expect(failed[0]?.error).toBe('the button stayed disabled');
    expect(overview.text).toContain('failed "approves the request"');
    expect((overview.data['exit'] as { code: number }).code).toBe(1);
  });

  it('reconstructs a frame as the compact format, screen text included', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const traceId = data['traceId'];

    const frame = await call('trace.frame_at', { traceId, stepIndex: 1 });
    expect(frame.isError, frame.text).toBe(false);
    expect(frame.data['semanticTree']).toBe('available');
    expect(frame.text).toContain('semanticTree: available');
    expect(frame.text).toMatch(/dialog "Permission" ref=semantic:n1@\d+ modal/u);
    expect(frame.text).toContain('visible text:');
    expect(frame.text).toContain('Permission required');

    const refs = frame.data['refs'] as { ref: string; name: string }[];
    expect(refs.map((entry) => entry.name)).toEqual(['Permission', 'Approve']);
  });

  it('addresses a moment by time, by step and by marker alike', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const traceId = data['traceId'];

    const overview = await call('trace.overview', { traceId });
    const markers = overview.data['markers'] as { timeMs: number; label: string }[];
    expect(markers.map((marker) => marker.label)).toContain('approves the request');

    const byMarker = await call('trace.frame_at', { traceId, marker: 'approves the request' });
    const byStep = await call('trace.frame_at', { traceId, stepIndex: 1 });
    const byTime = await call('trace.frame_at', { traceId, timeMs: byStep.data['timeMs'] });

    expect(byMarker.data['timeMs']).toBe(byStep.data['timeMs']);
    expect(byTime.text).toBe(byStep.text);
  });

  it('refuses an ambiguous or empty moment', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const traceId = data['traceId'];

    const none = await call('trace.frame_at', { traceId });
    expect(none.error?.kind).toBe('usage');

    const both = await call('trace.frame_at', { traceId, timeMs: 0, stepIndex: 0 });
    expect(both.error?.kind).toBe('usage');

    const missing = await call('trace.frame_at', { traceId, marker: 'nope' });
    expect(missing.error?.kind).toBe('usage');
    expect(missing.error?.suggestion).toContain('approves the request');
  });

  it('diffs two moments into changed rows and changed subtrees', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const traceId = data['traceId'];

    const diff = await call('trace.diff', { traceId, fromMs: 0, toMs: 3_000 });
    expect(diff.isError, diff.text).toBe(false);

    const rows = diff.data['changedRows'] as { text: string }[];
    expect(rows.some((row) => row.text.includes('Approve is disabled'))).toBe(true);

    const subtrees = diff.data['changedSubtrees'] as { change: string; compact: string }[];
    expect(subtrees).toHaveLength(1);
    expect(subtrees[0]?.change).toBe('updated');
    expect(subtrees[0]?.compact).toContain('disabled');
  });

  it('rejects a backwards window', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const result = await call('trace.diff', { traceId: data['traceId'], fromMs: 2_000, toMs: 1_000 });
    expect(result.error?.kind).toBe('usage');
  });
});

describe('trace failures an agent has to handle', () => {
  it('reports a path that holds nothing as not-found, not as a broken archive', async () => {
    const call = await connectSession();
    const result = await call('trace.open', { path: join(tmpdir(), 'termwright-absent.twtrace') });
    // A typo in a path and a corrupt artifact are different problems: this one
    // is 'not-found', the other stays 'protocol-violation'.
    expect(result.error?.kind).toBe('not-found');
    expect(result.error?.suggestion).toContain('.twtrace');
  });

  it('passes the reader’s protocol-violation through for a broken archive', async () => {
    const dir = await workspace();
    const path = join(dir, 'broken.twtrace');
    await mkdtemp(path).catch(() => undefined);
    await writeFile(join(dir, 'not-a-trace.txt'), 'nope', 'utf8');

    const call = await connectSession();
    const result = await call('trace.open', { path: join(dir, 'not-a-trace.txt') });
    expect(result.isError).toBe(true);
    expect(['protocol-violation', 'usage']).toContain(result.error?.kind);
  });

  it('reports an unknown handle as no-session', async () => {
    const call = await connectSession();
    const result = await call('trace.overview', { traceId: 'tr9' });
    expect(result.error?.kind).toBe('no-session');
    expect(result.error?.suggestion).toContain('trace.open');
  });

  it('rejects a screenshot scale outside the supported range', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const result = await call('trace.frame_at', {
      traceId: data['traceId'],
      stepIndex: 0,
      screenshot: true,
      screenshotScale: 9,
    });

    // zod bounds the parameter before the renderer ever sees it.
    expect(result.isError).toBe(true);
  });

  it('keeps one session’s traces invisible to another', async () => {
    const first = await connectSession();
    const second = await connectSession();
    const { data } = await first('trace.open', { path: await recordSample() });

    const foreign = await second('trace.overview', { traceId: data['traceId'] });
    expect(foreign.error?.kind).toBe('no-session');
  });
});

describe('the trace store', () => {
  it('evicts the coldest archive at the ceiling instead of refusing to open', async () => {
    const store = new TraceStore({ maxOpen: 1 });
    const first = await store.open(await recordSample());
    expect(first.evicted).toBeNull();

    const second = await store.open(await recordSample());
    expect(second.evicted).toBe(first.trace.id);
    expect(store.list().map((trace) => trace.id)).toEqual([second.trace.id]);
    // The handle is gone, and the failure says how to get it back.
    expect(() => store.get(first.trace.id)).toThrowError(/unknown trace/u);
    try {
      store.get(first.trace.id);
      expect.unreachable('the evicted handle must not resolve');
    } catch (error) {
      expect((error as McpError).kind).toBe('no-session');
      expect((error as McpError).suggestion).toContain('re-opened by path');
    }

    await store.closeAll();
  });

  it('refuses an archive above the size cap', async () => {
    const store = new TraceStore({ maxArchiveBytes: 1 });
    const path = join(await workspace(), 'packed.twtrace.zip');
    await packTrace(await recordSample(), path);

    await expect(store.open(path)).rejects.toThrowError(/ceiling is 1/u);
    await store.closeAll();
  });

  it('opens a zipped archive as readily as a directory', async () => {
    const store = new TraceStore();
    const path = join(await workspace(), 'packed.twtrace.zip');
    await packTrace(await recordSample(), path);

    const { trace } = await store.open(path);
    expect(trace.reader.container).toBe('zip');
    expect((await trace.reader.steps()).length).toBe(2);
    await store.closeAll();
  });
});

describe('PNG screenshots of a reconstructed frame', () => {
  /** PNG signature: an agent gets real bytes, not a placeholder. */
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

  it('attaches an ImageContent alongside the text, never instead of it', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const frame = await call('trace.frame_at', {
      traceId: data['traceId'],
      stepIndex: 1,
      screenshot: true,
    });

    expect(frame.isError, frame.text).toBe(false);
    // The text projection survives: an agent that cannot see images loses nothing.
    expect(frame.text).toContain('semanticTree: available');
    expect(frame.text).toContain('Permission required');

    const image = frame.content.find((part) => part.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    const bytes = Buffer.from(image?.data ?? '', 'base64');
    expect([...bytes.subarray(0, 4)]).toEqual(PNG_MAGIC);
    expect(bytes.byteLength).toBeGreaterThan(100);

    const described = frame.data['screenshot'] as {
      width: number;
      height: number;
      mimeType: string;
      selfContained: boolean;
    };
    expect(described.mimeType).toBe('image/png');
    expect(described.width).toBeGreaterThan(0);
    expect(described.height).toBeGreaterThan(0);
    expect(typeof described.selfContained).toBe('boolean');
  });

  it('scales the image on request', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const traceId = data['traceId'];

    const single = await call('trace.frame_at', { traceId, stepIndex: 1, screenshot: true });
    const double = await call('trace.frame_at', {
      traceId,
      stepIndex: 1,
      screenshot: true,
      screenshotScale: 2,
    });

    const at = (result: ToolResult): number => (result.data['screenshot'] as { width: number }).width;
    // Each size is rounded from the fractional SVG width, so 2x is within a pixel.
    expect(at(double)).toBeGreaterThanOrEqual(at(single) * 2 - 2);
    expect(at(double)).toBeLessThanOrEqual(at(single) * 2 + 2);
  });

  it('renders a light theme when asked', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const dark = await call('trace.frame_at', {
      traceId: data['traceId'],
      stepIndex: 1,
      screenshot: true,
    });
    const light = await call('trace.frame_at', {
      traceId: data['traceId'],
      stepIndex: 1,
      screenshot: true,
      screenshotTheme: 'light',
    });

    const bytes = (result: ToolResult): Buffer =>
      Buffer.from(result.content.find((part) => part.type === 'image')?.data ?? '', 'base64');
    expect(bytes(light).equals(bytes(dark))).toBe(false);
  });

  it('leaves the frame image-free unless it was asked for', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const frame = await call('trace.frame_at', { traceId: data['traceId'], stepIndex: 1 });

    expect(frame.content.every((part) => part.type === 'text')).toBe(true);
    expect(frame.data['screenshot']).toBeUndefined();
  });
});

describe('a crash recorded in the archive', () => {
  /** Writes a crash section into meta.json the way the trace writer will. */
  async function withCrashMeta(path: string): Promise<string> {
    const metaPath = join(path, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    // The shape @termwright/trace writes (TraceCrash): wall-clock `t`, a cast
    // offset for seeking, and the last semantic revision rather than the tree.
    meta['crash'] = {
      t: 2_500,
      castOffset: 2_400,
      exit: { code: 9, signal: null },
      screenTail: ['Traceback (most recent call last):', '  RuntimeError: boom'],
      recentInputs: [{ timeMs: 2_400, kind: 'key', bytes: 1, preview: '\\r' }],
      diagnosticsTail: [
        { code: 'pairing-timeout', detail: 'no marker for revision 3', timeMs: 2_450 },
        { code: 'mode-unverifiable', detail: 'ConPTY hides the mode', timeMs: 40, mode: 'focus' },
      ],
      lastSemanticRevision: 2,
    };
    await rewriteCommittedMember(path, 'meta.json', JSON.stringify(meta));
    return path;
  }

  it('shows the crash section in the overview, structured and readable', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await withCrashMeta(await recordSample()) });
    const overview = await call('trace.overview', { traceId: data['traceId'] });

    expect(overview.isError, overview.text).toBe(false);
    const crash = overview.data['crash'] as {
      exit: { code: number };
      screenTail: string[];
      lastSemanticRevision: number;
      diagnostics: unknown;
    };
    expect(crash.exit.code).toBe(9);
    expect(crash.screenTail).toContain('  RuntimeError: boom');
    expect(crash.lastSemanticRevision).toBe(2);
    // The cast offset is kept: that is the timeline frame_at and diff speak.
    expect((overview.data['crash'] as { timeMs: number }).timeMs).toBe(2_400);
    expect(overview.text).toContain('crash: the program exited on its own');
    expect(overview.text).toContain('RuntimeError: boom');
    expect(overview.text).toContain('diagnostic pairing-timeout');
    // The platform-blind diagnostic keeps the field naming which mode it means.
    const diagnostics = crash.diagnostics as { code: string; mode?: string }[];
    expect(diagnostics.find((entry) => entry.code === 'mode-unverifiable')?.mode).toBe('focus');
    expect(overview.text).toContain('diagnostic mode-unverifiable (focus)');
  });

  it('hands back a cast offset that frame_at can seek to', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await withCrashMeta(await recordSample()) });
    const traceId = data['traceId'];
    const overview = await call('trace.overview', { traceId });
    const crash = overview.data['crash'] as { timeMs: number };

    const frame = await call('trace.frame_at', { traceId, timeMs: crash.timeMs });
    expect(frame.isError, frame.text).toBe(false);
    expect(frame.text).toContain('semanticTree:');
  });

  it('says nothing about crashes for a recording that carries none', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const overview = await call('trace.overview', { traceId: data['traceId'] });

    expect(overview.data['crash']).toBeUndefined();
    expect(overview.text).not.toContain('crash:');
  });

  it('ignores a crash section it cannot make sense of, rather than failing the call', async () => {
    const path = await recordSample();
    const metaPath = join(path, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    meta['crash'] = { exit: 'not-an-object' };
    await rewriteCommittedMember(path, 'meta.json', JSON.stringify(meta));

    const call = await connectSession();
    const { data } = await call('trace.open', { path });
    const overview = await call('trace.overview', { traceId: data['traceId'] });

    expect(overview.isError, overview.text).toBe(false);
    expect(overview.data['crash']).toBeUndefined();
  });
});

describe('application logs in a recording', () => {
  it('shows what the program was saying as the screen reached a frame', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await withLogs(await recordSample()) });
    const frame = await call('trace.frame_at', { traceId: data['traceId'], timeMs: 2_500 });

    expect(frame.isError, frame.text).toBe(false);
    const logs = frame.data['logs'] as { message: string; level?: string }[];
    // Everything up to that moment, not after it.
    expect(logs.map((entry) => entry.message)).toEqual(['INFO booted', 'upstream refused the token']);
    expect(logs[1]?.level).toBe('error');
    expect(frame.text).toContain('upstream refused the token');
  });

  it('honours a log window of zero', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await withLogs(await recordSample()) });
    const frame = await call('trace.frame_at', {
      traceId: data['traceId'],
      timeMs: 2_500,
      maxLogs: 0,
    });

    expect(frame.data['logs']).toEqual([]);
    expect(frame.text).not.toContain('upstream refused');
  });

  it('reports the log entries between two moments in a diff', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await withLogs(await recordSample()) });
    const diff = await call('trace.diff', { traceId: data['traceId'], fromMs: 1_000, toMs: 2_500 });

    expect(diff.isError, diff.text).toBe(false);
    const logs = diff.data['logs'] as { message: string }[];
    // Strictly inside the window: 'booted' is before it, 'retrying' after.
    expect(logs.map((entry) => entry.message)).toEqual(['upstream refused the token']);
    expect(diff.data['logsOmitted']).toBe(0);
    expect(diff.text).toContain('upstream refused the token');
  });

  it('counts what the response ceiling trimmed from a diff window', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await withLogs(await recordSample()) });
    const diff = await call('trace.diff', {
      traceId: data['traceId'],
      fromMs: 0,
      toMs: 3_000,
      maxLogs: 1,
    });

    // The window is clamped to the recording, so the entry logged after the
    // last frame is out of range; of what remains, the newest is kept.
    expect(diff.data['toMs']).toBeLessThan(2_600);
    const logs = diff.data['logs'] as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('upstream refused the token');
    expect(diff.data['logsOmitted']).toBe(1);
    expect(diff.text).toContain('1 omitted');
  });

  it('says nothing about logs for a recording that has none', async () => {
    const call = await connectSession();
    const { data } = await call('trace.open', { path: await recordSample() });
    const frame = await call('trace.frame_at', { traceId: data['traceId'], stepIndex: 0 });
    expect(frame.data['logs']).toEqual([]);
  });
});
