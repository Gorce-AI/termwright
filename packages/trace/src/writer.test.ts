import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { parseCast } from './cast.js';
import { openTrace } from './reader.js';
import { TRACE_FILES, type TraceEvent } from './types.js';
import { createTraceWriter } from './writer.js';

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

describe('createTraceWriter', () => {
  it('round-trips a session through the reader', async () => {
    const root = await workspace();
    const dir = join(root, 'login.twtrace');
    const session = new FakeSession('sess-1');
    const writer = createTraceWriter(session, {
      dir,
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
    writer.recordAction({ api: 'locator.click', selector: 'button', ref: 'n1@7', ok: true });
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

  it('records input losslessly as base64 and keeps it out of the cast by default', async () => {
    const root = await workspace();
    const dir = join(root, 'input.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.input('\u0003', 'raw');
    await writer.finalize();

    const events = await readEvents(dir);
    expect(events[0]).toMatchObject({ kind: 'input', inputKind: 'raw', dataB64: 'Aw==' });
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

  it('refuses to finalize twice', async () => {
    const root = await workspace();
    const dir = join(root, 'twice.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    await writer.finalize();
    await expect(writer.finalize()).rejects.toThrow(/already/);
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
