import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession } from './__fixtures__/fake-session.js';
import { openTrace } from './reader.js';
import { generateHtmlReport } from './report.js';
import { TRACE_FILES, type ActionEvent, type TraceEvent } from './types.js';
import { rewriteCommittedMember } from './__fixtures__/committed.js';
import { createTraceWriter } from './writer.js';
import {
  SESSION_CAPABILITIES,
  type ActionabilityExplanation,
  type EffectiveSessionContract,
} from '@termwright/protocol';

const stamp = {
  sessionId: 't1',
  contractId: 't1:0',
  epoch: 0,
  sequence: 42,
  screenRevision: 7,
  semanticRevision: 42,
  pairedScreenRevision: 7,
} as const;

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
  it('persists and validates the frozen effective session contract for replay', async () => {
    const root = await workspace();
    const dir = join(root, 'contract.twtrace');
    const session = new FakeSession();
    const evidence = {
      source: 'terminal',
      method: 'native',
      strength: 'authoritative',
      providerId: 'terminal',
    } as const;
    const contract: EffectiveSessionContract = {
      contractId: 't1:0',
      sessionId: 't1',
      epoch: 0,
      protocol: 'termwright/2',
      framework: null,
      providers: [{ id: 'terminal', kind: 'terminal', version: '1' }],
      capabilities: Object.fromEntries(
        SESSION_CAPABILITIES.map((id) => [
          id,
          id === 'keyboard-input'
            ? { status: 'supported', evidence }
            : { status: 'unsupported', reason: 'not-negotiated' },
        ]),
      ) as unknown as EffectiveSessionContract['capabilities'],
      terminal: { profile: 'default', platform: 'linux', mouseModesObservable: true },
    };
    session.negotiatedContract = contract;
    const writer = createTraceWriter(session, { dir, now: session.now });
    await writer.finalize();

    const trace = await openTrace(dir);
    expect(trace.meta.contract).toEqual(contract);
    expect(Object.isFrozen(trace.meta.contract)).toBe(true);
    await trace.close();
  });

  it('records a successful action with its target', async () => {
    const root = await workspace();
    const dir = join(root, 'ok.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.tick(50);
    session.action('click', {
      selector: "getByRole('button', { name: 'Submit' })",
      ref: 'semantic:n8@42',
      observation: stamp,
      receipt: {
        intent: {
          kind: 'click',
          selector: "getByRole('button', { name: 'Submit' })",
          targetRef: 'semantic:n8@42',
        },
        plan: {
          actionId: 'a1',
          contractId: 't1:0',
          intent: { kind: 'click', targetRef: 'semantic:n8@42' },
          checkpoint: stamp,
          requirements: [],
          strategy: 'authoritative-pointer-region',
          valuePolicy: 'redacted',
          operations: [
            {
              device: 'mouse',
              kind: 'down',
              row: 3,
              column: 9,
              button: 'left',
              modifiers: ['shift', 'control'],
            },
            {
              device: 'mouse',
              kind: 'up',
              row: 3,
              column: 9,
              button: 'left',
              modifiers: ['shift', 'control'],
            },
          ],
        },
        before: stamp,
        after: { ...stamp, sequence: 43, screenRevision: 8, pairedScreenRevision: 8 },
        executed: [
          {
            device: 'mouse',
            kind: 'down',
            row: 3,
            column: 9,
            button: 'left',
            modifiers: ['shift', 'control'],
          },
          {
            device: 'mouse',
            kind: 'up',
            row: 3,
            column: 9,
            button: 'left',
            modifiers: ['shift', 'control'],
          },
        ],
        outcome: 'completed',
      },
    });
    await writer.finalize();

    const events = await readEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'action',
      api: 'click',
      selector: "getByRole('button', { name: 'Submit' })",
      ref: 'semantic:n8@42',
      ok: true,
      t: 50,
      castOffset: 50,
      observation: {
        sessionId: 't1',
        contractId: 't1:0',
        epoch: 0,
        sequence: 42,
        screenRevision: 7,
        semanticRevision: 42,
        pairedScreenRevision: 7,
      },
    });
    expect((events[0] as ActionEvent).error).toBeUndefined();
    const receipt = (events[0] as ActionEvent).receipt;
    expect(receipt).toMatchObject({ plan: { strategy: 'authoritative-pointer-region' } });
    expect(receipt?.executed[0]).toMatchObject({
      device: 'mouse',
      kind: 'down',
      row: 3,
      column: 9,
      modifiers: ['shift', 'control'],
    });
    expect(receipt?.executed).toEqual(receipt?.plan.operations);
  });

  it('rejects a forged completed receipt whose executed PTY input differs from the plan', async () => {
    const root = await workspace();
    const dir = join(root, 'forged-receipt.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.action('click', {
      ok: true,
      receipt: {
        intent: { kind: 'click' },
        plan: {
          actionId: 'a1',
          contractId: 't1:0',
          intent: { kind: 'click' },
          checkpoint: stamp,
          requirements: [],
          strategy: 'authoritative-pointer-region',
          valuePolicy: 'redacted',
          operations: [{ device: 'mouse', kind: 'down', row: 3, column: 9, button: 'left' }],
        },
        before: stamp,
        after: { ...stamp, sequence: 43 },
        executed: [{ device: 'mouse', kind: 'down', row: 99, column: 99, button: 'left' }],
        outcome: 'completed',
      },
    });
    await writer.finalize();

    const trace = await openTrace(dir);
    const drain = async (): Promise<void> => {
      for await (const _event of trace.events()) {
        /* consume */
      }
    };
    await expect(drain()).rejects.toThrow(/executed input differs/);
    await trace.close();
  });

  it('rejects forged mouse modifiers instead of replaying an input the driver cannot encode', async () => {
    const root = await workspace();
    const dir = join(root, 'forged-modifier.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    const operation = {
      device: 'mouse' as const,
      kind: 'down' as const,
      row: 3,
      column: 9,
      button: 'left' as const,
      modifiers: ['meta'] as never,
    };
    session.action('click', {
      ok: true,
      receipt: {
        intent: { kind: 'click' },
        plan: {
          actionId: 'a1',
          contractId: 't1:0',
          intent: { kind: 'click' },
          checkpoint: stamp,
          requirements: [],
          strategy: 'authoritative-pointer-region',
          valuePolicy: 'redacted',
          operations: [operation],
        },
        before: stamp,
        after: stamp,
        executed: [operation],
        outcome: 'completed',
      },
    });
    await writer.finalize();
    const trace = await openTrace(dir);
    const drain = async (): Promise<void> => {
      for await (const _event of trace.events()) {
        /* consume */
      }
    };
    await expect(drain()).rejects.toThrow(/modifiers is invalid/);
    await trace.close();
  });

  it('rejects a receipt whose planner checkpoint is from another revision', async () => {
    const root = await workspace();
    const dir = join(root, 'stale-receipt.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.action('click', {
      ok: true,
      receipt: {
        intent: { kind: 'click' },
        plan: {
          actionId: 'a1',
          contractId: 't1:0',
          intent: { kind: 'click' },
          checkpoint: { ...stamp, sequence: 41 },
          requirements: [],
          strategy: 'pointer',
          valuePolicy: 'redacted',
          operations: [],
        },
        before: stamp,
        after: stamp,
        executed: [],
        outcome: 'completed',
      },
    });
    await writer.finalize();
    const trace = await openTrace(dir);
    const drain = async (): Promise<void> => {
      for await (const _event of trace.events()) {
        /* consume */
      }
    };
    await expect(drain()).rejects.toThrow(/not bound to its before checkpoint/);
    await trace.close();
  });

  it('records a failed action with its error code, not prose', async () => {
    const root = await workspace();
    const dir = join(root, 'fail.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });

    session.action('click', { ok: false, error: 'not-actionable', selector: 'button' });
    await writer.finalize();

    expect((await readEvents(dir))[0]).toMatchObject({
      kind: 'action',
      api: 'click',
      ok: false,
      error: 'not-actionable',
    });
  });

  it('records the exact failed planner explanation for replay diagnostics', async () => {
    const root = await workspace();
    const dir = join(root, 'failed-plan.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    const evidence = {
      source: 'application',
      method: 'native',
      strength: 'authoritative',
      providerId: 'app.router',
    } as const;
    const actionability: ActionabilityExplanation = {
      actionable: false,
      intent: { kind: 'drag' as const, selector: 'button', targetRef: 'semantic:save@42' },
      checkpoint: stamp,
      requirements: [
        {
          condition: { kind: 'pointer-input' as const, target: 'save@42' },
          checkpoint: stamp,
          observation: { status: 'known' as const, value: true, evidence },
          verdict: 'satisfied' as const,
        },
        {
          condition: { kind: 'mouse-input-enabled' as const, target: 'save@42' },
          checkpoint: stamp,
          observation: { status: 'known' as const, value: false, evidence },
          verdict: 'unsatisfied' as const,
        },
      ],
      reason: {
        code: 'input-mode-disabled',
        message: 'Mouse reporting is disabled',
        targetRef: 'semantic:save@42',
      },
    };
    session.action('drag', { ok: false, error: 'input-mode-disabled', actionability });
    await writer.finalize();

    const trace = await openTrace(dir);
    const events: TraceEvent[] = [];
    for await (const event of trace.events()) events.push(event);
    await trace.close();
    expect((events[0] as ActionEvent).actionability).toEqual(actionability);
  });

  it('rejects a forged failed explanation with invalid evidence', async () => {
    const root = await workspace();
    const dir = join(root, 'forged-failed-plan.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, now: session.now });
    session.action('click', {
      ok: false,
      error: 'not-actionable',
      actionability: {
        actionable: false,
        intent: { kind: 'click' },
        checkpoint: stamp,
        requirements: [
          {
            condition: { kind: 'receives-pointer', target: 'save@42' },
            checkpoint: stamp,
            observation: {
              status: 'known',
              value: false,
              evidence: {
                source: 'application',
                method: 'native',
                strength: 'authoritative',
                providerId: 'app.router',
              },
            },
            verdict: 'unsatisfied',
          },
        ],
        reason: { code: 'covered-by', message: 'covered' },
      },
    });
    await writer.finalize();
    const eventsPath = join(dir, TRACE_FILES.events);
    const event = JSON.parse((await readFile(eventsPath, 'utf8')).trim()) as Record<
      string,
      unknown
    >;
    const explanation = event['actionability'] as {
      requirements: Array<{ observation: { evidence: { strength: string } } }>;
    };
    explanation.requirements[0]!.observation.evidence.strength = 'guessed';
    await rewriteCommittedMember(dir, TRACE_FILES.events, `${JSON.stringify(event)}\n`);

    const trace = await openTrace(dir);
    const drain = async (): Promise<void> => {
      for await (const _event of trace.events()) {
        /* consume */
      }
    };
    await expect(drain()).rejects.toThrow(/invalid evidence/);
    await trace.close();
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
    session.action('click', { ok: false, error: 'not-actionable', selector: 'button.primary' });
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
    expect(timeline).toContain('not-actionable');
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
