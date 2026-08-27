import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExecutableDeviceOperation,
  EffectiveSessionContract,
  EvidenceProvenance,
  ObservationStamp,
  SemanticNode,
  SemanticSnapshot,
} from '@termwright/protocol';
import { LocatorImpl, type LocatorContext } from './locator.js';
import { SemanticIndex } from './matching.js';
import { roleQuery, textMatcher } from './selectors.js';

const evidence: EvidenceProvenance = Object.freeze({
  source: 'framework',
  method: 'instrumented',
  strength: 'authoritative',
  providerId: 'retry-fixture',
});
const supported = Object.freeze({ status: 'supported' as const, evidence });
const contract: EffectiveSessionContract = Object.freeze({
  contractId: 'retry:0',
  sessionId: 'retry',
  epoch: 0,
  protocol: 'termwright/2',
  framework: null,
  providers: Object.freeze([]),
  capabilities: Object.freeze(
    Object.fromEntries(
      [
        'semantic-tree',
        'stable-identity',
        'intended-geometry',
        'clipped-geometry',
        'painted-region',
        'pointer-geometry',
        'pointer-hit-testing',
        'focus',
        'scroll',
        'render-order',
        'keyboard-input',
        'pointer-input',
        'paired-revisions',
      ].map((id) => [id, supported]),
    ) as EffectiveSessionContract['capabilities'],
  ),
  terminal: Object.freeze({ profile: 'xterm', platform: 'test', mouseModesObservable: true }),
});

function fixture(initial: 'disabled' | 'covered' | 'ready') {
  let phase: 'disabled' | 'covered' | 'ready' = initial;
  let sequence = 1;
  let statusWakeups = 0;
  const execute = vi.fn(async (operations: readonly ExecutableDeviceOperation[]) =>
    Object.freeze([...operations]),
  );

  const node = (): SemanticNode =>
    Object.freeze({
      id: 'save',
      role: 'button',
      name: 'Save',
      state: Object.freeze({ disabled: phase === 'disabled' }),
      geometry: Object.freeze({
        displayed: Object.freeze({ status: 'known', value: true, evidence }),
        intendedRect: Object.freeze({
          status: 'known',
          value: { row: 3, column: 8, width: 8, height: 1 },
          evidence,
        }),
        visibleRect: Object.freeze({
          status: 'known',
          value: { row: 3, column: 8, width: 8, height: 1 },
          evidence,
        }),
      }),
    });
  const snapshot = (): SemanticSnapshot =>
    Object.freeze({
      v: 2,
      sessionId: 'retry',
      revision: sequence,
      columns: 40,
      rows: 10,
      rootIds: Object.freeze(['save']),
      nodes: Object.freeze([node()]),
      coordinateSpace: Object.freeze({ status: 'known', value: 'viewport-cells', evidence }),
      hitGrid: Object.freeze({
        status: 'known',
        evidence,
        value: Object.freeze({
          regions: Object.freeze([
            Object.freeze({
              recipientId: phase === 'covered' ? 'overlay' : 'save',
              rect: Object.freeze({ row: 3, column: 8, width: 8, height: 1 }),
            }),
          ]),
        }),
      }),
    });
  const checkpoint = (): ObservationStamp =>
    Object.freeze({
      sessionId: 'retry',
      contractId: 'retry:0',
      epoch: 0,
      sequence,
      screenRevision: sequence,
      semanticRevision: sequence,
      pairedScreenRevision: sequence,
    });
  const ctx: LocatorContext = {
    sessionId: 'retry',
    artifactValuePolicy: 'redacted',
    timeouts: { action: 1_000, text: 1_000, idle: 1_000, ready: 1_000, exit: 1_000 },
    actionObservationState: () => 'settled',
    negotiationPending: () => false,
    negotiationSettled: async () => undefined,
    semanticIndex: () => new SemanticIndex(snapshot()),
    semanticAttached: () => true,
    semanticPossible: () => true,
    semanticViolation: () => null,
    semanticRevision: () => sequence,
    screenRevision: () => sequence,
    checkpoint,
    contract: () => contract,
    semanticNode: (id) => (id === 'save' ? node() : undefined),
    hitGrid: () => snapshot().hitGrid,
    pointerRegion: (id) =>
      id === 'save'
        ? Object.freeze({
            regionBounds: Object.freeze({ row: 3, column: 8, width: 8, height: 1 }),
            spans: Object.freeze([Object.freeze({ row: 3, from: 8, to: 16 })]),
            evidence,
          })
        : undefined,
    screenRegionUnchangedSince: () => true,
    rows: () => Object.freeze([]),
    modes: () =>
      Object.freeze({
        mouseTracking: 'any',
        mouseEncoding: 'sgr',
        bracketedPaste: false,
        applicationCursorKeys: false,
        applicationKeypad: false,
        focusReporting: 'off',
        synchronizedOutput: false,
      }),
    identityKind: () => 'stable',
    semanticBoundsAreAbsolute: () => true,
    waitForChange: async () => {
      statusWakeups += 1;
      // Two unrelated status notifications do not cause planner retries. The
      // third wake commits the paired enable/uncover observation.
      if (statusWakeups === 3) {
        phase = 'ready';
        sequence = 2;
      }
    },
    sendInput: async () => undefined,
    executeDeviceOperations: execute,
    beginAction: () => 'a1',
    endAction: () => undefined,
    errorDiagnostics: () => ({ semanticTree: true }),
    assertOpen: () => undefined,
  };
  return { ctx, execute, statusWakeups: () => statusWakeups };
}

describe('Locator action retry execution', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['disabled', 'covered'] as const)(
    'waits for a paired %s target and executes exactly one physical click plan',
    async (initial) => {
      const test = fixture(initial);
      const locator = new LocatorImpl(test.ctx, roleQuery('button', textMatcher('Save', true), {}));

      const receipt = await locator.click();

      expect(test.statusWakeups()).toBe(3);
      expect(test.execute).toHaveBeenCalledOnce();
      expect(test.execute.mock.calls[0]?.[0].map((operation) => operation.kind)).toEqual([
        'down',
        'up',
      ]);
      expect(receipt.executed).toHaveLength(2);
    },
  );

  it('writes no physical plan when the single action budget is already exhausted', async () => {
    const test = fixture('covered');
    const locator = new LocatorImpl(test.ctx, roleQuery('button', textMatcher('Save', true), {}));

    await expect(locator.click({ timeout: 0 })).rejects.toMatchObject({ code: 'not-actionable' });
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('does not resolve or emit input when the owning attempt budget expired before planning', async () => {
    const test = fixture('ready');
    const expired = Object.assign(new Error('attempt operation budget exhausted'), {
      code: 'TW_ATTEMPT_BUDGET_EXCEEDED',
    });
    test.ctx.operationTimeout = () => {
      throw expired;
    };
    const locator = new LocatorImpl(test.ctx, roleQuery('button', textMatcher('Save', true), {}));

    await expect(locator.click({ timeout: 500 })).rejects.toBe(expired);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('bounds delayed negotiation inside the action budget and emits no input', async () => {
    vi.useFakeTimers();
    const test = fixture('disabled');
    test.ctx.negotiationPending = () => true;
    test.ctx.negotiationSettled = () => new Promise<void>(() => undefined);
    test.ctx.waitForChange = (deadline) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, deadline - performance.now()));
      });
    const locator = new LocatorImpl(test.ctx, roleQuery('button', textMatcher('Save', true), {}));
    const started = Date.now();

    const action = locator.click({ timeout: 25 });
    const rejected = expect(action).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    expect(Date.now() - started).toBe(25);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('applies the direct waitFor timeout to capability negotiation', async () => {
    vi.useFakeTimers();
    const test = fixture('disabled');
    test.ctx.negotiationPending = () => true;
    test.ctx.negotiationSettled = () => new Promise<void>(() => undefined);
    test.ctx.waitForChange = (deadline) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, deadline - performance.now()));
      });
    const locator = new LocatorImpl(test.ctx, roleQuery('button', textMatcher('Save', true), {}));
    const started = Date.now();

    const wait = locator.waitFor({ state: 'visible', timeout: 40 });
    const rejected = expect(wait).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(40);
    await rejected;

    expect(Date.now() - started).toBe(40);
    expect(test.execute).not.toHaveBeenCalled();
  });
});
