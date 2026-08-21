import { describe, expect, it } from 'vitest';
import type {
  Condition,
  EffectiveSessionContract,
  EvidenceProvenance,
  ObservationStamp,
  SemanticNode,
} from '@termwright/protocol';
import { ActionPlanner, evaluateCondition, type ActionPlannerContext } from './action-planner.js';

const evidence: EvidenceProvenance = Object.freeze({
  source: 'framework', method: 'instrumented', strength: 'authoritative', providerId: 'test-probe',
});
const stamp: ObservationStamp = Object.freeze({
  sessionId: 's', contractId: 's:0', epoch: 0, sequence: 7,
  screenRevision: 4, semanticRevision: 3, pairedScreenRevision: 4,
});

function context(
  overrides: Partial<SemanticNode> = {},
  contextOverrides: Partial<ActionPlannerContext> = {},
): ActionPlannerContext {
  const node = {
    id: 'field', role: 'textbox', name: 'Name', state: { focused: true },
    geometry: {
      displayed: { status: 'known', value: true, evidence },
      intendedRect: { status: 'known', value: { row: 2, column: 3, width: 6, height: 1 }, evidence },
      visibleRect: { status: 'known', value: { row: 2, column: 3, width: 6, height: 1 }, evidence },
    },
    ...overrides,
  } as SemanticNode;
  const supported = Object.freeze({ status: 'supported' as const, evidence });
  const capabilities = Object.fromEntries([
    'semantic-tree', 'stable-identity', 'intended-geometry', 'clipped-geometry', 'painted-region',
    'pointer-geometry', 'pointer-hit-testing', 'focus', 'scroll', 'render-order', 'keyboard-input',
    'pointer-input', 'paired-revisions',
  ].map((id) => [id, supported])) as EffectiveSessionContract['capabilities'];
  const contract: EffectiveSessionContract = Object.freeze({
    contractId: 's:0', sessionId: 's', epoch: 0, protocol: 'termwright/2', framework: null,
    providers: Object.freeze([]), capabilities: Object.freeze(capabilities),
    terminal: Object.freeze({ profile: 'xterm', platform: 'test', mouseModesObservable: true }),
  });
  return {
    actionObservationState: () => 'settled',
    checkpoint: () => stamp,
    contract: () => contract,
    modes: () => ({
      mouseTracking: 'any', mouseEncoding: 'sgr', bracketedPaste: false,
      applicationCursorKeys: false, applicationKeypad: false,
      focusReporting: 'off', synchronizedOutput: false,
    }),
    semanticNode: (id) => id === node.id ? node : undefined,
    pointerRegion: (id) => id === node.id ? ({
      regionBounds: { row: 2, column: 3, width: 6, height: 1 },
      spans: [{ row: 2, from: 3, to: 9 }], evidence,
    }) : undefined,
    screenRegionUnchangedSince: () => true,
    hitGrid: () => ({ status: 'known', value: { regions: [{ recipientId: node.id, rect: { row: 2, column: 3, width: 6, height: 1 } }] }, evidence }),
    errorDiagnostics: () => ({ semanticTree: true }),
    ...contextOverrides,
  };
}

const target = Object.freeze({
  ref: 'field@3', semantic: true, identity: 'stable' as const, revision: 3,
  rect: { row: 2, column: 3, width: 6, height: 1 }, role: 'textbox', name: 'Name', state: { focused: true },
});

describe('canonical condition evaluation', () => {
  it('does not turn unknown or unsupported into success through negation', () => {
    const condition = { kind: 'not', condition: { kind: 'visible', target: 'x' } } as const;
    expect(evaluateCondition(condition, stamp, () => ({ status: 'unknown', reason: 'provider-refresh' })).verdict).toBe('inconclusive');
    expect(evaluateCondition(condition, stamp, () => ({ status: 'unsupported', capability: 'clipped-geometry', reason: 'capability' })).verdict).toBe('inconclusive');
  });
});

describe('ActionPlanner keyboard strategies', () => {
  it.each(['parser-in-flight', 'semantic-frame-open', 'pairing-pending'] as const)(
    'fails closed while action evidence is %s',
    (state) => {
      const planner = new ActionPlanner(context({}, { actionObservationState: () => state }));
      expect(() => planner.planKeyboard('pending', { kind: 'activate', targetRef: target.ref }, target))
        .toThrow(expect.objectContaining({
          code: 'stale-snapshot',
          message: expect.stringContaining(state),
        }));
      expect(() => planner.planPointer('pending-pointer', { kind: 'click', targetRef: target.ref }, target))
        .toThrow(expect.objectContaining({
          code: 'stale-snapshot',
          message: expect.stringContaining(state),
        }));
    },
  );

  it('rejects unfocused type without planning hidden pointer input', () => {
    const planner = new ActionPlanner(context({ state: { focused: false } }));
    let failure: unknown;
    try {
      planner.planKeyboard('a1', { kind: 'type', targetRef: target.ref }, target, 'Ada');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 'not-actionable',
      actionability: {
        actionable: false,
        checkpoint: stamp,
        reason: { code: 'not-actionable' },
      },
    });
    expect(planner.explain({ kind: 'type', targetRef: target.ref }, target, undefined, 'Ada')).toMatchObject({
      actionable: false, reason: { code: 'not-actionable' },
    });
  });

  it('plans fill as focus, select-all and physical typing at one checkpoint', () => {
    const plan = new ActionPlanner(context({ state: { focused: false } }))
      .planKeyboard('a2', { kind: 'fill', targetRef: target.ref }, target, 'Ada');
    expect(plan.strategy).toBe('pointer-focus-select-all-type');
    expect(plan.operations.map(({ device, kind }) => `${device}:${kind}`)).toEqual([
      'mouse:down', 'mouse:up', 'keyboard:press', 'keyboard:type',
    ]);
    expect(plan.operations[2]).toMatchObject({ value: 'Control+A' });
    expect(plan.requirements.every(({ checkpoint }) => checkpoint === stamp)).toBe(true);
  });

  it('uses the same production plan for actionability and activation', () => {
    const planner = new ActionPlanner(context());
    const plan = planner.planKeyboard('a3', { kind: 'activate', targetRef: target.ref }, target);
    const explanation = planner.explain({ kind: 'activate', targetRef: target.ref }, target);
    expect(explanation).toMatchObject({ actionable: true, strategy: plan.strategy, requirements: plan.requirements });
    expect(plan.operations).toEqual([{ device: 'keyboard', kind: 'press', value: 'Enter' }]);
  });

  it('makes check idempotent and rejects non-checkable targets', () => {
    const checkbox = { ...target, role: 'checkbox' as const, state: { focused: true, checked: true } };
    const planner = new ActionPlanner(context({ role: 'checkbox', state: { focused: true, checked: true } }));
    expect(planner.planKeyboard('a4', { kind: 'check', targetRef: target.ref }, checkbox).operations).toEqual([]);
    expect(() => new ActionPlanner(context()).planKeyboard('a5', { kind: 'check', targetRef: target.ref }, target))
      .toThrowError(expect.objectContaining({ code: 'not-actionable' }));
  });
});

describe('ActionPlanner runtime input requirements', () => {
  it('allows hover over a disabled target without weakening click actionability', () => {
    const planner = new ActionPlanner(context({ state: { focused: false, disabled: true } }));
    const hover = planner.planPointer('disabled-hover', { kind: 'hover', targetRef: target.ref }, target);

    expect(hover.plan.operations).toEqual([
      expect.objectContaining({ device: 'mouse', kind: 'move' }),
    ]);
    expect(hover.plan.requirements.some(({ condition }) => condition.kind === 'enabled')).toBe(false);
    expect(() => planner.planPointer('disabled-click', { kind: 'click', targetRef: target.ref }, target))
      .toThrowError(expect.objectContaining({ code: 'not-actionable' }));
  });

  it('allows an unrelated newer screen revision when the target region is unchanged', () => {
    const newer = Object.freeze({ ...stamp, sequence: 8, screenRevision: 5, pairedScreenRevision: 4 });
    const planner = new ActionPlanner(context({}, {
      checkpoint: () => newer,
      screenRegionUnchangedSince: () => true,
    }));
    expect(planner.planPointer('stable-local', { kind: 'click', targetRef: target.ref }, target).plan.checkpoint)
      .toBe(newer);
  });

  it('rejects a newer screen revision that damaged the target region', () => {
    const newer = Object.freeze({ ...stamp, sequence: 8, screenRevision: 5, pairedScreenRevision: 4 });
    const planner = new ActionPlanner(context({}, {
      checkpoint: () => newer,
      screenRegionUnchangedSince: () => false,
    }));
    expect(() => planner.planPointer('damaged-local', { kind: 'click', targetRef: target.ref }, target))
      .toThrowError(expect.objectContaining({ code: 'stale-snapshot' }));
  });

  it('accepts an explicit frozen application region contract without inventing a hit test', () => {
    const base = context();
    const baseContract = base.contract();
    if (baseContract === null) throw new Error('test contract missing');
    const appEvidence = Object.freeze({
      source: 'application' as const,
      method: 'declared' as const,
      strength: 'authoritative' as const,
      providerId: 'app.regions',
    });
    const contract = Object.freeze({
      ...baseContract,
      providers: Object.freeze([{
        id: 'app.regions', kind: 'application' as const, version: '1',
        method: 'declared' as const, capabilities: Object.freeze(['pointer-regions' as const]),
      }]),
      capabilities: Object.freeze({
        ...baseContract.capabilities,
        'pointer-geometry': Object.freeze({ status: 'supported' as const, evidence: appEvidence }),
        'pointer-hit-testing': Object.freeze({ status: 'unsupported' as const, reason: 'not-negotiated' as const }),
      }),
    });
    const planner = new ActionPlanner(context({}, {
      contract: () => contract,
      pointerRegion: () => ({
        regionBounds: { row: 2, column: 3, width: 6, height: 1 },
        spans: [{ row: 2, from: 3, to: 9 }],
        evidence: appEvidence,
      }),
      hitGrid: () => ({
        status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable',
      }),
    }));

    const { plan } = planner.planPointer('region-only', { kind: 'click', targetRef: target.ref }, target);
    expect(plan.physicalRegion?.spans).toEqual([{ row: 2, from: 3, to: 9 }]);
    expect(plan.requirements.find(({ condition }) => condition.kind === 'receives-pointer'))
      .toMatchObject({ verdict: 'satisfied', observation: { evidence: appEvidence } });
  });

  it('does not promote framework geometry to ownership when hit testing is unavailable', () => {
    const base = context();
    const baseContract = base.contract();
    if (baseContract === null) throw new Error('test contract missing');
    const contract = Object.freeze({
      ...baseContract,
      capabilities: Object.freeze({
        ...baseContract.capabilities,
        'pointer-hit-testing': Object.freeze({ status: 'unsupported' as const, reason: 'not-negotiated' as const }),
      }),
    });
    const planner = new ActionPlanner(context({}, {
      contract: () => contract,
      hitGrid: () => ({
        status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable',
      }),
    }));
    expect(() => planner.planPointer('geometry-is-not-ownership', { kind: 'click', targetRef: target.ref }, target))
      .toThrowError(expect.objectContaining({ code: 'capability-unavailable' }));
  });

  it('accepts authoritative production-router ownership when framework display state is unavailable', () => {
    const planner = new ActionPlanner(context({
      geometry: {
        displayed: { status: 'unsupported', capability: 'displayed', reason: 'framework-unobservable' },
        intendedRect: { status: 'unsupported', capability: 'intended-geometry', reason: 'framework-unobservable' },
        visibleRect: { status: 'unsupported', capability: 'clipped-geometry', reason: 'framework-unobservable' },
      },
    }));

    const { plan } = planner.planPointer('provider-click', { kind: 'click', targetRef: target.ref }, target);
    expect(plan.strategy).toBe('authoritative-pointer-region');
    expect(plan.operations.map(({ device, kind }) => `${device}:${kind}`)).toEqual([
      'mouse:down', 'mouse:up',
    ]);
    expect(plan.requirements.find(({ condition }) => condition.kind === 'displayed'))
      .toMatchObject({ verdict: 'inconclusive' });
  });

  it('fails closed when semantic evidence cannot be paired with a terminal frame', () => {
    const base = context();
    const baseContract = base.contract();
    if (baseContract === null) throw new Error('test contract missing');
    const unpairedContract = Object.freeze({
      ...baseContract,
      capabilities: Object.freeze({
        ...baseContract.capabilities,
        'paired-revisions': Object.freeze({ status: 'unsupported' as const, reason: 'not-negotiated' as const }),
      }),
    });
    const unpairedStamp = Object.freeze({ ...stamp, pairedScreenRevision: null });
    const planner = new ActionPlanner(context({}, {
      checkpoint: () => unpairedStamp,
      contract: () => unpairedContract,
    }));

    expect(() => planner.planPointer('unpaired-pointer', { kind: 'click', targetRef: target.ref }, target))
      .toThrowError(expect.objectContaining({ code: 'capability-unavailable' }));
    expect(() => planner.planKeyboard('unpaired-keyboard', { kind: 'type', targetRef: target.ref }, target, 'x'))
      .toThrowError(expect.objectContaining({ code: 'capability-unavailable' }));
  });

  it('distinguishes pointer support from a mouse mode that blocks drag', () => {
    const planner = new ActionPlanner(context({}, {
      modes: () => ({
        mouseTracking: 'vt200', mouseEncoding: 'sgr', bracketedPaste: false,
        applicationCursorKeys: false, applicationKeypad: false,
        focusReporting: 'off', synchronizedOutput: false,
      }),
    }));
    let failure: unknown;
    try {
      planner.planPointer('a6', { kind: 'drag', targetRef: target.ref }, target);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 'input-mode-disabled',
      actionability: {
        requirements: [
          { condition: { kind: 'pointer-input' }, verdict: 'satisfied' },
          { condition: { kind: 'mouse-input-enabled' }, verdict: 'unsatisfied' },
        ],
      },
    });
  });

  it('treats an absent region as current non-actionability, not missing session support', () => {
    const planner = new ActionPlanner(context({}, { pointerRegion: () => undefined }));
    let failure: unknown;
    try {
      planner.planPointer('a7', { kind: 'click', targetRef: target.ref }, target);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'not-actionable' });
    const explanation = (failure as { actionability?: { requirements: readonly { condition: Condition; verdict: string }[] } }).actionability;
    expect(explanation?.requirements.find(({ condition }) => condition.kind === 'pointer-region'))
      .toMatchObject({ verdict: 'unsatisfied' });
  });
});
