import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession } from './__fixtures__/fake-session.js';
import { openTrace } from './reader.js';
import { generateHtmlReport } from './report.js';
import { TRACE_FILES, type ActionEvent, type TraceEvent } from './types.js';
import { createTraceWriter } from './writer.js';

const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-action-'));
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

describe('actions from the driver', () => {
  it('records a successful action with its target', async () => {
    const root = await workspace();
    const dir = join(root, 'ok.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.tick(50);
    session.action('click', {
      selector: "getByRole('button', { name: 'Submit' })",
      ref: 'n8@42',
      observation: { sessionId: 't1', screenRevision: 7, semanticRevision: 42 },
    });
    await writer.finalize();

    const events = await readEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'action',
      api: 'click',
      selector: "getByRole('button', { name: 'Submit' })",
      ref: 'n8@42',
      ok: true,
      t: 50,
      castOffset: 50,
      observation: { sessionId: 't1', screenRevision: 7, semanticRevision: 42 },
    });
    expect((events[0] as ActionEvent).error).toBeUndefined();
  });

  it('records a failed action with its error code, not prose', async () => {
    const root = await workspace();
    const dir = join(root, 'fail.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.action('click', { ok: false, error: 'unsupported-action', selector: 'button' });
    await writer.finalize();

    expect((await readEvents(dir))[0]).toMatchObject({
      kind: 'action',
      api: 'click',
      ok: false,
      error: 'unsupported-action',
    });
  });

  it('omits selector for a harness action that had no target', async () => {
    const root = await workspace();
    const dir = join(root, 'harness.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.action('resize');
    await writer.finalize();

    const event = (await readEvents(dir))[0] as ActionEvent;
    expect(event.api).toBe('resize');
    expect(event.selector).toBeUndefined();
    expect(event.ref).toBeUndefined();
  });

  it('attributes an action to the step it happened in', async () => {
    const root = await workspace();
    const dir = join(root, 'step.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    const step = writer.addStep('submit');
    session.tick(10);
    session.action('press');
    step.end('passed');
    await writer.finalize();

    const action = (await readEvents(dir)).find((event) => event.kind === 'action');
    expect(action).toMatchObject({ stepId: 's1' });
  });

  it('records the action after the bytes it sent, as the driver reports it', async () => {
    const root = await workspace();
    const dir = join(root, 'order.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    // The driver writes to the PTY, then reports the finished action.
    session.input('\r', 'key');
    session.tick(5);
    session.action('press', { selector: 'button' });
    await writer.finalize();

    const kinds = (await readEvents(dir)).map((event) => event.kind);
    expect(kinds).toEqual(['input', 'action']);
  });

  it('keeps recording actions the driver cannot see', async () => {
    const root = await workspace();
    const dir = join(root, 'manual.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.action('click', { selector: 'button' });
    writer.recordAction({ api: 'custom.helper', ok: true });
    await writer.finalize();

    const apis = (await readEvents(dir))
      .filter((event) => event.kind === 'action')
      .map((event) => (event as ActionEvent).api);
    expect(apis).toEqual(['click', 'custom.helper']);
  });

  it('reaches the reader as an action event', async () => {
    const root = await workspace();
    const dir = join(root, 'read.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.action('type', { selector: 'textbox' });
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      const collected: TraceEvent[] = [];
      for await (const event of trace.events()) collected.push(event);
      expect(collected.map((event) => event.kind)).toEqual(['action']);
    } finally {
      await trace.close();
    }
  });
});

describe('failed actions in the report', () => {
  it('puts them on the timeline with their error code', async () => {
    const root = await workspace();
    const dir = join(root, 'report.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    const step = writer.addStep('approve');
    session.tick(40);
    session.action('click', { ok: false, error: 'unsupported-action', selector: 'button.primary' });
    session.tick(10);
    session.action('press', { ok: true, selector: 'button.primary' });
    step.end('failed', 'nothing happened');
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'approves', status: 'failed', tracePath: dir }],
    });

    const timeline = html.slice(html.indexOf('<h3>Timeline</h3>'));
    expect(timeline).toContain('<tr class="tw-action-failed">');
    expect(timeline).toContain('unsupported-action');
    expect(timeline).toContain('button.primary');
    expect(timeline).toContain('<td>approve</td>');
    // Successful actions stay out — the timeline is for what went wrong.
    expect(timeline).not.toContain('>press<');
  });

  it('leaves the timeline alone when every action succeeded', async () => {
    const root = await workspace();
    const dir = join(root, 'clean.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    writer.addStep('all good').end('passed');
    session.action('click', { selector: 'button' });
    await writer.finalize();

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [{ id: 't1', title: 'fine', status: 'failed', tracePath: dir }],
    });
    // The class always exists in the stylesheet; no row should use it.
    expect(html).not.toContain('<tr class="tw-action-failed">');
    expect(html).toContain('<td>all good</td>');
  });
});
