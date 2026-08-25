import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { parseCast } from './cast.js';
import { openTrace } from './reader.js';
import { TRACE_FILES, type TraceEvent } from './types.js';
import { createTraceWriter, traceStagingPrefix } from './writer.js';
import { createRunId } from '@termwright/protocol';

const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-'));
  temporaries.push(dir);
  return dir;
}

async function readCast(dir: string): Promise<ReturnType<typeof parseCast>> {
  return parseCast(await readFile(join(dir, TRACE_FILES.cast), 'utf8'));
}

async function readEvents(dir: string): Promise<TraceEvent[]> {
  const text = await readFile(join(dir, TRACE_FILES.events), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceEvent);
}

describe('trace targets', () => {
  it('delivers into a directory the caller already created', async () => {
    // Preparing the output directory first is ordinary, and POSIX renames the
    // staged directory straight onto an existing empty one. Windows refuses as
    // soon as the target exists, so without handling this the writer could not
    // deliver a trace there at all.
    const dir = await workspace();
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('ready');
    await writer.finalize();
    expect(await readFile(join(dir, TRACE_FILES.cast), 'utf8')).toContain('ready');
  });

  it('refuses a target that already holds something instead of replacing it', async () => {
    const dir = await workspace();
    await writeFile(join(dir, 'keep.txt'), 'not mine to delete', 'utf8');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.output('ready');
    await expect(writer.finalize()).rejects.toThrow(/already holds content/u);
    expect(await readFile(join(dir, 'keep.txt'), 'utf8')).toBe('not mine to delete');
  });
});

describe('trace staging names', () => {
  it('cannot be mistaken for a half-written run', () => {
    // run-history names its own incomplete runs `.staging-<run>` and decodes
    // every directory with that prefix as one. A trace staged in the same
    // place must not answer to it, or a half-written trace is read back as a
    // half-written run.
    const prefix = traceStagingPrefix('/runs/twtrace-abc');
    expect(prefix.startsWith('.staging-')).toBe(false);
    expect(prefix).toBe('.twtrace-abc.staging-');
    expect(prefix).toContain('.staging-');
  });
});

describe('createTraceWriter', () => {
  it('replays output, semantic state and exit emitted before the writer attaches', async () => {
    const root = await workspace();
    const dir = join(root, 'startup-replay.twtrace');
    const session = new FakeSession('startup-session');
    session.output('startup byte');
    session.semantic(snapshot(1, [node({ id: 'boot', role: 'text', name: 'Booted' })], 'startup-session'));
    session.exit(0);

    const writer = createTraceWriter(session, { dir, now: session.now });
    await writer.finalize();

    expect((await readCast(dir)).events.map((event) => event.data).join('')).toContain('startup byte');
    const trace = await openTrace(dir);
    try {
      const semantics = [];
      for await (const record of trace.semantics()) semantics.push(record);
      expect(semantics).toHaveLength(1);
      expect(semantics[0]?.snapshot.nodes[0]?.name).toBe('Booted');
      expect(trace.meta.exit).toEqual({ code: 0, signal: null });
    } finally {
      await trace.close();
    }
  });

  it('does not persist a sensitive semantic sentinel under the secure default', async () => {
    const secret = 'TW_SENTINEL_semantic_61b987';
    const dir = await workspace();
    const session = new FakeSession('secret-session');
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.input(secret, 'key');
    session.semantic(snapshot(1, [node({
      id: 'password', role: 'textbox', name: 'Password',
      value: { status: 'known', value: secret, sensitivity: 'sensitive', evidence: { source: 'application', method: 'native', strength: 'authoritative', providerId: 'app' } },
    })], 'secret-session'));
    await writer.finalize();
    const semanticArtifact = await readFile(join(dir, TRACE_FILES.semantics), 'utf8');
    const eventArtifact = await readFile(join(dir, TRACE_FILES.events), 'utf8');
    const castArtifact = await readFile(join(dir, TRACE_FILES.cast), 'utf8');
    expect(semanticArtifact).not.toContain(secret);
    expect(eventArtifact).not.toContain(secret);
    expect(castArtifact).not.toContain(secret);
    expect(eventArtifact).toContain('"recording":"withheld"');
    expect(semanticArtifact).toContain('"status":"withheld"');
  });
  it('writes a real Unix start timestamp while elapsed time uses a monotonic clock', async () => {
    const root = await workspace();
    const dir = join(root, 'wall-time.twtrace');
    const session = new FakeSession();
    const before = Math.floor(Date.now() / 1000);
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.tick(25);
    session.output('ready');
    await writer.finalize();

    const after = Math.floor(Date.now() / 1000);
    const { header, events } = await readCast(dir);
    expect(header.timestamp).toBeGreaterThanOrEqual(before);
    expect(header.timestamp).toBeLessThanOrEqual(after);
    expect(events[0]?.timeMs).toBe(25);
  });

  it('round-trips a session through the reader', async () => {
    const root = await workspace();
    const dir = join(root, 'login.twtrace');
    const session = new FakeSession('sess-1');
    const runIdentity = {
      invocationId: createRunId('invocation'),
      runId: createRunId('run'),
      projectId: createRunId('project'),
      specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'),
      executionId: createRunId('execution'),
      attemptId: createRunId('attempt'),
      sessionId: createRunId('session'),
    } as const;
    const writer = createTraceWriter(session, {
      dir,
      runIdentity,
      command: ['node', 'app.js'],
      columns: 80,
      rows: 24,
      now: session.now,
      platform: 'linux',
    });

    session.tick(100);
    session.output('hello ');
    const step = writer.addStep('type the name');
    session.tick(50);
    session.input('ab', 'key');
    session.semantic(snapshot(7, [node({ id: 'n1', role: 'button', name: 'Submit' })], 'sess-1'));
    writer.recordAction({ api: 'locator.click', selector: 'button', ref: 'semantic:n1@7', ok: true });
    session.tick(50);
    session.output('world');
    step.end('passed');
    session.tick(10);
    session.exit(0);

    const archive = await writer.finalize();
    expect(archive.meta.sessionId).toBe('sess-1');
    expect(archive.meta.command).toEqual(['node', 'app.js']);
    expect(archive.meta.exit).toEqual({ code: 0, signal: null });
    expect(archive.meta.semanticTree).toBe(true);
    expect(archive.meta.platform).toBe('linux');
    expect(archive.meta.runIdentity).toEqual(runIdentity);

    const trace = await openTrace(dir);
    try {
      expect(trace.container).toBe('directory');
      const header = await trace.castHeader();
      expect(header.version).toBe(3);
      expect(header.term).toEqual({ cols: 80, rows: 24 });

      const events: TraceEvent[] = [];
      for await (const event of trace.events()) events.push(event);
      expect(events.map((event) => event.kind)).toEqual([
        'step-start',
        'input',
        'action',
        'step-end',
      ]);

      const steps = await trace.steps();
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ title: 'type the name', status: 'passed' });

      const records = [];
      for await (const record of trace.semantics()) records.push(record);
      expect(records).toHaveLength(1);
      expect(records[0]?.revision).toBe(7);
      expect(records[0]?.snapshot.nodes[0]?.name).toBe('Submit');
    } finally {
      await trace.close();
    }
  });

  it('writes one cast marker per step, labelled with the step title', async () => {
    const root = await workspace();
    const dir = join(root, 'steps.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.tick(100);
    const outer = writer.addStep('outer');
    session.tick(100);
    const inner = writer.addStep('inner');
    inner.end();
    outer.end();
    await writer.finalize();

    const { events } = await readCast(dir);
    const markers = events.filter((event) => event.code === 'm');
    expect(markers.map((event) => [event.data, event.timeMs])).toEqual([
      ['outer', 100],
      ['inner', 200],
    ]);

    const traceEvents = await readEvents(dir);
    const start = traceEvents.find(
      (event) => event.kind === 'step-start' && event.title === 'inner',
    );
    expect(start?.castOffset).toBe(200);
    expect(start).toMatchObject({ parentStepId: 's1' });
  });

  it('retains a stable authored Gherkin id and physical source', async () => {
    const root = await workspace();
    const dir = join(root, 'gherkin-step.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    writer.addStep('Given a terminal is running', {
      stepId: 'tw-step-1',
      gherkin: {
        keyword: 'Given', text: 'a terminal is running',
        source: { file: '/repo/demo.feature', line: 4, column: 5 },
      },
    }).end();
    await writer.finalize();
    const trace = await openTrace(dir);
    try {
      expect(await trace.steps()).toMatchObject([{
        stepId: 'tw-step-1',
        gherkin: { keyword: 'Given', text: 'a terminal is running', source: { line: 4, column: 5 } },
      }]);
    } finally {
      await trace.close();
    }
  });

  it('excludes output produced between hide() and show()', async () => {
    const root = await workspace();
    const dir = join(root, 'hidden.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.tick(10);
    session.output('visible-1 ');
    writer.hide();
    expect(writer.isHidden()).toBe(true);
    session.tick(500);
    session.output('SECRET');
    session.tick(100);
    writer.show();
    expect(writer.isHidden()).toBe(false);
    session.tick(10);
    session.output('visible-2');
    await writer.finalize();

    const { events } = await readCast(dir);
    const output = events.filter((event) => event.code === 'o').map((event) => event.data);
    expect(output).toEqual(['visible-1 ', 'visible-2']);
    // 620ms of wall time, 600 of it hidden.
    expect(events[events.length - 1]?.timeMs).toBe(20);
  });

  it('closes an open hide window at finalize', async () => {
    const root = await workspace();
    const dir = join(root, 'still-hidden.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.output('shown');
    writer.hide();
    session.tick(50);
    session.output('hidden');
    await writer.finalize();

    const { events } = await readCast(dir);
    expect(events.filter((event) => event.code === 'o').map((event) => event.data)).toEqual([
      'shown',
    ]);
  });

  it('trims idle gaps on export and records the limit in the header', async () => {
    const root = await workspace();
    const dir = join(root, 'idle.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.output('a');
    session.tick(30_000);
    session.output('b');
    await writer.finalize({ idleTimeLimit: 2 });

    const { header, events } = await readCast(dir);
    expect(header.idle_time_limit).toBe(2);
    expect(events.map((event) => event.timeMs)).toEqual([0, 2_000]);

    const trace = await openTrace(dir);
    expect(trace.meta.idleTimeLimit).toBe(2);
    expect(trace.meta.durationMs).toBe(2_000);
    await trace.close();
  });

  it('maps semantic snapshots onto the trimmed cast timeline', async () => {
    const root = await workspace();
    const dir = join(root, 'semantic-offset.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.output('a');
    session.tick(10_000);
    session.semantic(snapshot(1, [node({ id: 'n1', role: 'text', name: 'idle' })]));
    session.tick(10_000);
    session.output('b');
    await writer.finalize({ idleTimeLimit: 1 });

    const trace = await openTrace(dir);
    try {
      const records = [];
      for await (const record of trace.semantics()) records.push(record);
      expect(records[0]?.t).toBe(10_000);
      // The whole 20s gap compresses to 1s; the midpoint lands at 500ms.
      expect(records[0]?.castOffset).toBe(500);
    } finally {
      await trace.close();
    }
  });

  it('decodes multi-byte output split across chunks', async () => {
    const root = await workspace();
    const dir = join(root, 'utf8.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    const bytes = new TextEncoder().encode('✓ ok');
    session.outputBytes(bytes.slice(0, 2));
    session.tick(5);
    session.outputBytes(bytes.slice(2));
    await writer.finalize();

    const { events } = await readCast(dir);
    expect(events.map((event) => event.data).join('')).toBe('✓ ok');
  });

  it('records input losslessly only with explicit raw policy and keeps it out of the cast by default', async () => {
    const root = await workspace();
    const dir = join(root, 'input.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now, artifactValuePolicy: 'raw' });

    session.input('\u0003', 'raw');
    await writer.finalize();

    const events = await readEvents(dir);
    expect(events[0]).toMatchObject({ kind: 'input', inputKind: 'raw', dataB64: 'Aw==', recording: 'raw' });
    const { events: castEvents } = await readCast(dir);
    expect(castEvents.some((event) => event.code === 'i')).toBe(false);
  });

  it('records resizes in both the cast and the event log', async () => {
    const root = await workspace();
    const dir = join(root, 'resize.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now, columns: 80, rows: 24 });

    session.tick(20);
    session.resize(120, 40);
    await writer.finalize();

    const { events } = await readCast(dir);
    expect(events.find((event) => event.code === 'r')?.data).toBe('120x40');
    const traceEvents = await readEvents(dir);
    expect(traceEvents[0]).toMatchObject({ kind: 'resize', columns: 120, rows: 40 });
  });

  it('marks steps left open at finalize as skipped', async () => {
    const root = await workspace();
    const dir = join(root, 'open-step.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    writer.addStep('never closed');
    await writer.finalize();

    const trace = await openTrace(dir);
    expect((await trace.steps())[0]?.status).toBe('skipped');
    await trace.close();
  });

  it('stops recording output once the byte ceiling is hit', async () => {
    const root = await workspace();
    const dir = join(root, 'truncated.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now, maxOutputBytes: 16 });

    session.output('0123456789');
    session.tick(1);
    session.output('this chunk pushes past the limit');
    session.tick(1);
    session.output('dropped too');
    const archive = await writer.finalize();

    expect(archive.meta.truncated).toBe(true);
    const { events } = await readCast(dir);
    expect(events.map((event) => event.data)).toEqual(['0123456789']);
  });

  it('shares the committed result across repeated finalize calls', async () => {
    const root = await workspace();
    const dir = join(root, 'twice.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    const first = await writer.finalize();
    await expect(writer.finalize()).resolves.toEqual(first);
  });

  it('can retry atomic publication after a persistence failure', async () => {
    const root = await workspace();
    const dir = join(root, 'retry.twtrace');
    await mkdir(dir);
    await writeFile(join(dir, 'occupied'), 'do not overwrite');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    await expect(writer.finalize()).rejects.toBeDefined();
    expect(await stat(join(dir, TRACE_FILES.commit)).catch(() => null)).toBeNull();
    await rm(dir, { recursive: true });
    const archive = await writer.finalize();
    expect(archive.dir).toBe(dir);
    expect(await stat(join(dir, TRACE_FILES.commit))).not.toBeNull();
  });

  it('stops observing the session after dispose', async () => {
    const root = await workspace();
    const dir = join(root, 'disposed.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.output('before');
    writer.dispose();
    session.tick(10);
    session.output('after');
    await writer.finalize();

    const { events } = await readCast(dir);
    expect(events.map((event) => event.data)).toEqual(['before']);
  });
});
