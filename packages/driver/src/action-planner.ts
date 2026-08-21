import type {
  ActionIntent,
  ActionPlan,
  ActionabilityExplanation,
  Condition,
  ConditionResult,
  DeviceOperation,
  EffectiveSessionContract,
  EvidenceProvenance,
  Observation,
  ObservationStamp,
  PhysicalRegion,
  PointerHitGrid,
  Rect,
  SemanticNode,
} from '@termwright/protocol';
import type { ErrorDiagnostics, PointerOptions, ResolvedTarget, TerminalModes, WaitOptions } from './api.js';
import { CapabilityUnavailableError, InputModeDisabledError, NotActionableError, StaleSnapshotError, TermwrightError } from './errors.js';
import { normalizeMouseModifiers } from './mouse.js';

export interface ActionPlannerContext {
  checkpoint(): ObservationStamp;
  contract(): EffectiveSessionContract | null;
  modes(): TerminalModes;
  semanticNode(id: string): SemanticNode | undefined;
  hitGrid(): Observation<PointerHitGrid> | undefined;
  pointerRegion(id: string): { readonly regionBounds: Rect; readonly spans: PhysicalRegion['spans']; readonly evidence: EvidenceProvenance } | undefined;
  errorDiagnostics(extra?: Partial<ErrorDiagnostics>): ErrorDiagnostics;
}

export interface PlannedPointerAction {
  readonly plan: ActionPlan;
  readonly point: { readonly row: number; readonly column: number };
}

export interface PlannedWheelOptions extends WaitOptions {
  readonly position?: { readonly rowOffset: number; readonly columnOffset: number };
  readonly deltaY?: number;
  readonly deltaX?: number;
  readonly modifiers?: readonly ('shift' | 'alt' | 'control')[];
}

export interface PlannedDragOptions {
  readonly steps?: number;
  readonly path?: readonly { readonly row: number; readonly column: number }[];
  readonly modifiers?: readonly ('shift' | 'alt' | 'control')[];
}

/**
 * A frozen application pointer-region provider may itself be the production
 * ownership contract. This is intentionally narrower than "has geometry": the
 * evidence must be authoritative, application-owned, and trace back to the
 * one provider that negotiated pointer-regions. If any hit-test provider was
 * negotiated, callers must verify against that stronger observation instead.
 */
export function isAuthoritativeRegionOwnership(
  contract: EffectiveSessionContract | null,
  evidence: EvidenceProvenance,
): boolean {
  if (
    contract === null
    || evidence.source !== 'application'
    || evidence.strength !== 'authoritative'
    || evidence.providerId === undefined
  ) return false;
  const provider = contract.providers.find((candidate) =>
    candidate.kind === 'application' && candidate.id === evidence.providerId);
  return provider?.kind === 'application'
    && provider.capabilities.includes('pointer-regions')
    && !contract.providers.some((candidate) =>
      candidate.kind === 'application' && candidate.capabilities.includes('hit-test'));
}

function result(condition: Condition, checkpoint: ObservationStamp, observation: Observation<boolean>): ConditionResult {
  return Object.freeze({
    condition,
    checkpoint,
    observation,
    verdict: observation.status === 'known'
      ? observation.value ? 'satisfied' : 'unsatisfied'
      : 'inconclusive',
  });
}

export type LeafCondition = Exclude<Condition, { readonly kind: 'not' | 'all' | 'any' }>;

/** Evaluate one canonical condition tree without coercing missing evidence. */
export function evaluateCondition(
  condition: Condition,
  checkpoint: ObservationStamp,
  observe: (condition: LeafCondition) => Observation<boolean>,
): ConditionResult {
  if (condition.kind === 'not') {
    return combineCondition(condition, checkpoint, [evaluateCondition(condition.condition, checkpoint, observe)]);
  }
  if (condition.kind === 'all' || condition.kind === 'any') {
    return combineCondition(
      condition,
      checkpoint,
      condition.conditions.map((child) => evaluateCondition(child, checkpoint, observe)),
    );
  }
  return result(condition, checkpoint, observe(condition as LeafCondition));
}

/** Canonical boolean condition algebra. Negation never turns missing evidence into success. */
export function combineCondition(
  condition: Condition,
  checkpoint: ObservationStamp,
  children: readonly ConditionResult[],
): ConditionResult {
  const inconclusive = (observation: Observation<boolean>): ConditionResult => Object.freeze({
    condition, checkpoint, observation, verdict: 'inconclusive',
  });
  if (condition.kind === 'not') {
    const child = children[0];
    if (child === undefined) {
      return result(condition, checkpoint, {
        status: 'known', value: true,
        evidence: { source: 'driver', method: 'derived', strength: 'authoritative', providerId: 'termwright-condition' },
      });
    }
    if (child.observation.status !== 'known') return inconclusive(child.observation);
    return result(condition, checkpoint, { status: 'known', value: !child.observation.value, evidence: child.observation.evidence });
  }
  const knownChildren = children.filter((entry) => entry.observation.status === 'known');
  const decisive = condition.kind === 'all'
    ? knownChildren.find((entry) => entry.observation.status === 'known' && !entry.observation.value)
    : knownChildren.find((entry) => entry.observation.status === 'known' && entry.observation.value);
  if (decisive?.observation.status === 'known') return result(condition, checkpoint, decisive.observation);
  if (knownChildren.length !== children.length) {
    return inconclusive(children.find((entry) => entry.observation.status !== 'known')!.observation);
  }
  const observation = knownChildren[0]?.observation;
  return observation === undefined
    ? result(condition, checkpoint, {
        status: 'known', value: condition.kind === 'all',
        evidence: { source: 'driver', method: 'derived', strength: 'authoritative', providerId: 'termwright-condition' },
      })
    : observation.status === 'known'
      ? result(condition, checkpoint, { status: 'known', value: condition.kind === 'all', evidence: observation.evidence })
      : inconclusive(observation);
}

function choosePoint(region: PhysicalRegion, requested?: PointerOptions['position']): { row: number; column: number } | null {
  if (requested !== undefined) {
    const point = {
      row: region.intendedRect.row + requested.rowOffset,
      column: region.intendedRect.column + requested.columnOffset,
    };
    return region.spans.some((span) => span.row === point.row && point.column >= span.from && point.column < span.to) ? point : null;
  }
  const centerRow = region.intendedRect.row + (region.intendedRect.height - 1) / 2;
  const centerColumn = region.intendedRect.column + (region.intendedRect.width - 1) / 2;
  let best: { row: number; column: number; distance: number } | null = null;
  for (const span of region.spans) {
    // An even-sized region has two central cells. Prefer the earlier cell so
    // the aim is stable and matches terminal/grid coordinate conventions.
    const column = Math.max(span.from, Math.min(span.to - 1, Math.floor(centerColumn)));
    const distance = Math.abs(span.row - centerRow) + Math.abs(column - centerColumn);
    if (best === null || distance < best.distance || (distance === best.distance && (span.row < best.row || (span.row === best.row && column < best.column)))) {
      best = { row: span.row, column, distance };
    }
  }
  return best === null ? null : { row: best.row, column: best.column };
}

function modeRequirement(kind: ActionIntent['kind'], modes: TerminalModes, diagnostics: ErrorDiagnostics): void {
  if (modes.mouseTracking === 'unknown' || modes.mouseEncoding === 'unknown') {
    throw new InputModeDisabledError('terminal mouse mode is not observable; Termwright will not guess an input protocol', diagnostics);
  }
  if (modes.mouseTracking === 'none') {
    throw new InputModeDisabledError('the application has not enabled terminal mouse reporting', diagnostics);
  }
  if (kind === 'hover' && modes.mouseTracking !== 'any') {
    throw new InputModeDisabledError('hover requires any-event mouse tracking (CSI ? 1003 h)', diagnostics);
  }
  if (kind === 'drag' && modes.mouseTracking !== 'drag' && modes.mouseTracking !== 'any') {
    throw new InputModeDisabledError('drag requires drag or any-event mouse tracking (CSI ? 1002/1003 h)', diagnostics);
  }
}

function mouseModeAllows(kind: ActionIntent['kind'], modes: TerminalModes): boolean {
  if (modes.mouseTracking === 'unknown' || modes.mouseEncoding === 'unknown' || modes.mouseTracking === 'none') return false;
  if (kind === 'hover') return modes.mouseTracking === 'any';
  if (kind === 'drag') return modes.mouseTracking === 'drag' || modes.mouseTracking === 'any';
  return true;
}

/** Pure planner used by Locator actions and by actionability diagnostics. */
export class ActionPlanner {
  readonly #ctx: ActionPlannerContext;
  #lastRequirements: readonly ConditionResult[] = Object.freeze([]);
  #lastCheckpoint: ObservationStamp | null = null;

  constructor(ctx: ActionPlannerContext) {
    this.#ctx = ctx;
  }

  planPointer(
    actionId: string,
    intent: ActionIntent,
    target: ResolvedTarget,
    options?: PointerOptions,
  ): PlannedPointerAction {
    try {
      return this.#planPointer(actionId, intent, target, options);
    } catch (error) {
      throw this.#attachFailure(error, intent);
    }
  }

  #planPointer(
    actionId: string,
    intent: ActionIntent,
    target: ResolvedTarget,
    options?: PointerOptions,
  ): PlannedPointerAction {
    this.#lastRequirements = Object.freeze([]);
    const checkpoint = this.#ctx.checkpoint();
    this.#lastCheckpoint = checkpoint;
    const diagnostics = this.#ctx.errorDiagnostics({ candidates: [target] });
    const modes = this.#ctx.modes();
    const terminalEvidence: EvidenceProvenance = Object.freeze({
      source: 'terminal', method: 'native', strength: 'authoritative', providerId: 'termwright-vt',
    });
    const requirements: ConditionResult[] = [
      result(
        { kind: 'pointer-input', target: target.ref },
        checkpoint,
        this.#capabilityBoolean('pointer-input', true),
      ),
      result(
        { kind: 'mouse-input-enabled', target: target.ref },
        checkpoint,
        { status: 'known', value: mouseModeAllows(intent.kind, modes), evidence: terminalEvidence },
      ),
    ];
    this.#remember(requirements);
    if (requirements[0]?.verdict !== 'satisfied') {
      throw new CapabilityUnavailableError('physical pointer input is outside the effective session contract', diagnostics);
    }
    if (requirements[1]?.verdict !== 'satisfied') modeRequirement(intent.kind, modes, diagnostics);
    const attached: Condition = { kind: 'attached', target: target.ref };
    const attachedResult = result(attached, checkpoint, this.#capabilityBoolean(target.semantic ? 'semantic-tree' : 'pointer-input', true));
    requirements.push(attachedResult);
    this.#remember(requirements);
    if (attachedResult.verdict === 'inconclusive') {
      throw new CapabilityUnavailableError(
        target.semantic ? 'semantic attachment is unavailable' : 'physical pointer input is unavailable',
        diagnostics,
      );
    }

    if (target.semantic) {
      this.#requireCapability(
        'paired-revisions',
        'semantic pointer actions require a probe revision paired with the committed terminal frame',
        diagnostics,
      );
      if (target.revision !== checkpoint.semanticRevision || checkpoint.pairedScreenRevision !== checkpoint.screenRevision) {
        throw new StaleSnapshotError('semantic target and terminal screen do not belong to one committed observation', diagnostics);
      }
      const contract = this.#ctx.contract();
      const verifiesOwnership = contract?.capabilities['pointer-hit-testing'].status === 'supported';
      const nodeId = target.ref.split('@')[0] ?? '';
      const node = this.#ctx.semanticNode(nodeId);
      if (node === undefined) throw new StaleSnapshotError(`semantic target ${target.ref} is detached`, diagnostics);
      const enabled: Condition = { kind: 'enabled', target: target.ref };
      const displayed: Condition = { kind: 'displayed', target: target.ref };
      const enabledResult = result(enabled, checkpoint, this.#capabilityBoolean('semantic-tree', node.state?.disabled !== true));
      const displayedResult = result(displayed, checkpoint, node.geometry.displayed);
      requirements.push(enabledResult, displayedResult);
      this.#remember(requirements);
      // A framework may not expose paint/display state while an application
      // provider exposes the production pointer router authoritatively. Do not
      // reject that stronger, action-specific proof before consulting it.
      // Known disabled/hidden state still fails immediately.
      if (requirements.some((entry) => entry.verdict === 'unsatisfied')) {
        throw new NotActionableError(`target ${target.ref} is disabled or not displayed`, diagnostics);
      }
      if (enabledResult.verdict === 'inconclusive') {
        throw new CapabilityUnavailableError(`target ${target.ref} has inconclusive enabled state`, diagnostics);
      }
      const pointerRegion = this.#ctx.pointerRegion(nodeId);
      const pointerRegionResult = result(
        { kind: 'pointer-region', target: target.ref },
        checkpoint,
        this.#capabilityBoolean('pointer-geometry', pointerRegion !== undefined),
      );
      requirements.push(pointerRegionResult);
      this.#remember(requirements);
      if (pointerRegionResult.verdict === 'inconclusive') {
        throw new CapabilityUnavailableError('the negotiated contract cannot provide authoritative pointer regions', diagnostics);
      }
      if (pointerRegion === undefined) throw new NotActionableError(`target ${target.ref} has no physical pointer region in this committed frame`, diagnostics);
      const hitGrid = this.#ctx.hitGrid();
      if (verifiesOwnership && hitGrid?.status !== 'known') {
        throw new CapabilityUnavailableError('the committed frame has no authoritative pointer ownership map', diagnostics);
      }
      if (!verifiesOwnership && !isAuthoritativeRegionOwnership(contract, pointerRegion.evidence)) {
        throw new CapabilityUnavailableError(
          'pointer ownership needs negotiated hit testing or an explicit authoritative application region contract',
          diagnostics,
        );
      }
      const authoritativeHitGrid = hitGrid?.status === 'known' ? hitGrid.value : undefined;
      const spans = !verifiesOwnership
        ? pointerRegion.spans
        : pointerRegion.spans.flatMap((candidate) => authoritativeHitGrid !== undefined
          ? authoritativeHitGrid.regions
              .filter((entry) => entry.recipientId === nodeId)
              .flatMap((entry) => Array.from({ length: entry.rect.height }, (_, offset) => ({
                row: entry.rect.row + offset,
                from: Math.max(candidate.from, entry.rect.column),
                to: Math.min(candidate.to, entry.rect.column + entry.rect.width),
              })))
              .filter((hit) => candidate.row === hit.row && hit.from < hit.to)
              .map((hit) => Object.freeze(hit))
          : []);
      const region = Object.freeze<PhysicalRegion>({
        checkpoint,
        coordinateSpace: 'viewport-cells',
        intendedRect: pointerRegion.regionBounds,
        spans: Object.freeze(spans),
        evidence: pointerRegion.evidence,
      });
      const point = choosePoint(region, options?.position);
      const receives: Condition = { kind: 'receives-pointer', target: target.ref };
      requirements.push(result(receives, checkpoint, {
        status: 'known',
        value: point !== null,
        evidence: verifiesOwnership && hitGrid?.status === 'known' ? hitGrid.evidence : pointerRegion.evidence,
      }));
      this.#remember(requirements);
      if (point === null) throw new NotActionableError(`no unoccluded pointer cell belongs to ${target.ref}`, diagnostics);
      const operations = this.#operations(intent, point, options);
      return { point, plan: Object.freeze({ actionId, contractId: checkpoint.contractId, intent, checkpoint, requirements: Object.freeze(requirements), strategy: 'authoritative-pointer-region', physicalRegion: region, operations }) };
    }

    if (target.revision !== checkpoint.screenRevision) {
      throw new StaleSnapshotError('screen target and terminal screen do not belong to one committed observation', diagnostics);
    }
    if (target.rect === null) throw new NotActionableError('screen target has no physical rectangle', diagnostics);
    const evidence: EvidenceProvenance = Object.freeze({ source: 'terminal', method: 'measured', strength: 'authoritative', providerId: 'termwright-vt' });
    const region = Object.freeze<PhysicalRegion>({
      checkpoint,
      coordinateSpace: 'viewport-cells',
      intendedRect: target.rect,
      spans: Object.freeze(Array.from({ length: target.rect.height }, (_, offset) => Object.freeze({ row: target.rect!.row + offset, from: target.rect!.column, to: target.rect!.column + target.rect!.width }))),
      evidence,
    });
    const point = choosePoint(region, options?.position);
    if (point === null) throw new NotActionableError('screen target has no actionable cell', diagnostics);
    const operations = this.#operations(intent, point, options);
    return { point, plan: Object.freeze({ actionId, contractId: checkpoint.contractId, intent, checkpoint, requirements: Object.freeze(requirements), strategy: 'screen-region', physicalRegion: region, operations }) };
  }

  planKeyboard(
    actionId: string,
    intent: ActionIntent,
    target: ResolvedTarget,
    value = '',
  ): ActionPlan {
    try {
      return this.#planKeyboard(actionId, intent, target, value);
    } catch (error) {
      throw this.#attachFailure(error, intent);
    }
  }

  #planKeyboard(
    actionId: string,
    intent: ActionIntent,
    target: ResolvedTarget,
    value = '',
  ): ActionPlan {
    this.#lastRequirements = Object.freeze([]);
    const checkpoint = this.#ctx.checkpoint();
    this.#lastCheckpoint = checkpoint;
    const diagnostics = this.#ctx.errorDiagnostics({ candidates: [target] });
    this.#requireCapability('keyboard-input', `${intent.kind} requires physical keyboard input`, diagnostics);
    if (!target.semantic) {
      throw new CapabilityUnavailableError(`${intent.kind} requires an authoritative focused semantic target`, diagnostics);
    }
    this.#requireCapability(
      'paired-revisions',
      `${intent.kind} requires a semantic revision paired with the committed terminal frame`,
      diagnostics,
    );
    if (target.revision !== checkpoint.semanticRevision || checkpoint.pairedScreenRevision !== checkpoint.screenRevision) {
      throw new StaleSnapshotError(`${intent.kind} target and terminal screen do not belong to one committed observation`, diagnostics);
    }
    const nodeId = target.ref.split('@')[0] ?? '';
    const node = this.#ctx.semanticNode(nodeId);
    if (node === undefined) throw new StaleSnapshotError(`${intent.kind} target is detached`, diagnostics);
    const requirements: ConditionResult[] = [
      result({ kind: 'attached', target: target.ref }, checkpoint, this.#capabilityBoolean('semantic-tree', true)),
      result({ kind: 'enabled', target: target.ref }, checkpoint, this.#capabilityBoolean('semantic-tree', node.state?.disabled !== true)),
      result({ kind: 'displayed', target: target.ref }, checkpoint, node.geometry.displayed),
    ];
    this.#remember(requirements);
    if (requirements.some((entry) => entry.verdict === 'inconclusive')) {
      throw new CapabilityUnavailableError(`${intent.kind} needs conclusive target state`, diagnostics);
    }
    if (requirements.some((entry) => entry.verdict === 'unsatisfied')) {
      throw new NotActionableError(`${intent.kind} target is disabled or not displayed`, diagnostics);
    }
    const focused = node.state?.focused;
    const focusResult = result(
      { kind: 'focused', target: target.ref },
      checkpoint,
      this.#capabilityBoolean('focus', focused === true),
    );
    requirements.push(focusResult);
    this.#remember(requirements);
    if (focusResult.verdict === 'inconclusive') {
      throw new CapabilityUnavailableError(`${intent.kind} needs authoritative focus observation`, diagnostics);
    }

    if (intent.kind === 'type' || intent.kind === 'press') {
      if (focused !== true) throw new NotActionableError(`${intent.kind} requires ${target.ref} to be focused`, diagnostics);
      const operations: readonly DeviceOperation[] = Object.freeze([{ device: 'keyboard', kind: intent.kind === 'press' ? 'press' : 'type', value }]);
      return Object.freeze({ actionId, contractId: checkpoint.contractId, intent, checkpoint, requirements: Object.freeze(requirements), strategy: 'focused-keyboard', operations });
    }
    if (intent.kind === 'fill') {
      const pointer = focused === true ? null : this.planPointer(actionId, { kind: 'focus', targetRef: target.ref }, target);
      const focusOps = pointer?.plan.operations ?? [];
      const operations: readonly DeviceOperation[] = Object.freeze([...focusOps, { device: 'keyboard', kind: 'press', value: 'Control+A' }, { device: 'keyboard', kind: 'type', value }]);
      return Object.freeze({
        actionId, contractId: checkpoint.contractId, intent, checkpoint,
        requirements: Object.freeze(pointer === null ? requirements : [...requirements, ...pointer.plan.requirements]),
        strategy: focused === true ? 'focused-select-all-type' : 'pointer-focus-select-all-type',
        ...(pointer?.plan.physicalRegion === undefined ? {} : { physicalRegion: pointer.plan.physicalRegion }),
        operations,
      });
    }
    if (intent.kind === 'focus') {
      const pointer = focused === true ? null : this.planPointer(actionId, { kind: 'focus', targetRef: target.ref }, target);
      return Object.freeze({
        actionId, contractId: checkpoint.contractId, intent, checkpoint,
        requirements: Object.freeze(pointer === null ? requirements : [...requirements, ...pointer.plan.requirements]),
        strategy: focused === true ? 'already-focused' : 'authoritative-pointer-focus',
        ...(pointer?.plan.physicalRegion === undefined ? {} : { physicalRegion: pointer.plan.physicalRegion }),
        operations: pointer?.plan.operations ?? [],
      });
    }
    if (intent.kind === 'activate' || intent.kind === 'check' || intent.kind === 'uncheck') {
      const desired = intent.kind === 'check' ? true : intent.kind === 'uncheck' ? false : undefined;
      if (desired !== undefined && node.role !== 'checkbox' && node.role !== 'radio') {
        throw new NotActionableError(`${intent.kind} requires a checkbox or radio target`, diagnostics);
      }
      if (desired !== undefined && typeof node.state?.checked !== 'boolean') {
        throw new CapabilityUnavailableError(`${intent.kind} needs an authoritative checked state`, diagnostics);
      }
      if (desired !== undefined && node.state?.checked === desired) {
        requirements.push(result({ kind: 'checked', target: target.ref, value: desired }, checkpoint, this.#capabilityBoolean('semantic-tree', true)));
        this.#remember(requirements);
        return Object.freeze({ actionId, contractId: checkpoint.contractId, intent, checkpoint, requirements: Object.freeze(requirements), strategy: 'already-in-state', operations: Object.freeze([]) });
      }
      if (focused === true) {
        const key = node.role === 'checkbox' || node.role === 'radio' ? 'Space' : 'Enter';
        const operations: readonly DeviceOperation[] = Object.freeze([{ device: 'keyboard', kind: 'press', value: key }]);
        return Object.freeze({ actionId, contractId: checkpoint.contractId, intent, checkpoint, requirements: Object.freeze(requirements), strategy: key === 'Space' ? 'focus-space' : 'focus-enter', operations });
      }
      const pointer = this.planPointer(actionId, { kind: 'activate', targetRef: target.ref }, target);
      return Object.freeze({
        ...pointer.plan,
        intent,
        requirements: Object.freeze([...requirements, ...pointer.plan.requirements]),
        strategy: 'authoritative-pointer-activate',
      });
    }
    throw new CapabilityUnavailableError(`planner does not support keyboard intent ${intent.kind}`, diagnostics);
  }

  planWheel(
    actionId: string,
    intent: ActionIntent,
    target: ResolvedTarget,
    options: PlannedWheelOptions,
  ): PlannedPointerAction {
    const vertical = this.#wheelDelta(options.deltaY ?? 0, 'deltaY');
    const horizontal = this.#wheelDelta(options.deltaX ?? 0, 'deltaX');
    if (vertical === 0 && horizontal === 0) {
      throw new TypeError('locator.wheel() requires a non-zero deltaY or deltaX');
    }
    const planned = this.planPointer(actionId, intent, target, options);
    const modifiers = normalizeMouseModifiers(options.modifiers);
    const operations = Object.freeze([
      ...Array.from({ length: Math.abs(vertical) }, () => Object.freeze<DeviceOperation>({
        device: 'mouse', kind: 'wheel', ...planned.point, modifiers, deltaY: Math.sign(vertical),
      })),
      ...Array.from({ length: Math.abs(horizontal) }, () => Object.freeze<DeviceOperation>({
        device: 'mouse', kind: 'wheel', ...planned.point, modifiers, deltaX: Math.sign(horizontal),
      })),
    ]);
    return Object.freeze({
      point: planned.point,
      plan: Object.freeze({ ...planned.plan, strategy: `${planned.plan.strategy}-wheel`, operations }),
    });
  }

  planDrag(
    actionId: string,
    intent: ActionIntent,
    source: ResolvedTarget,
    destination: ResolvedTarget,
    options: PlannedDragOptions = {},
  ): PlannedPointerAction {
    const from = this.planPointer(actionId, { ...intent, targetRef: source.ref }, source);
    const to = this.planPointer(actionId, { ...intent, targetRef: destination.ref }, destination);
    if (from.plan.checkpoint.contractId !== to.plan.checkpoint.contractId ||
        from.plan.checkpoint.sequence !== to.plan.checkpoint.sequence) {
      throw new StaleSnapshotError(
        'drag source and destination do not belong to one committed observation',
        this.#ctx.errorDiagnostics({ candidates: [source, destination] }),
      );
    }
    const steps = options.steps ?? Math.max(
      Math.abs(to.point.row - from.point.row),
      Math.abs(to.point.column - from.point.column),
      1,
    );
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > 1_000) {
      throw new RangeError(`locator.dragTo() steps must be an integer from 1 to 1000, received ${String(steps)}`);
    }
    const path = options.path === undefined
      ? Array.from({ length: steps }, (_, index) => {
          const ratio = (index + 1) / steps;
          return Object.freeze({
            row: Math.round(from.point.row + (to.point.row - from.point.row) * ratio),
            column: Math.round(from.point.column + (to.point.column - from.point.column) * ratio),
          });
        })
      : [...options.path.map((point) => this.#point(point, 'locator.dragTo() path')), to.point];
    const unique = path.filter((point, index) =>
      index === 0 || point.row !== path[index - 1]?.row || point.column !== path[index - 1]?.column,
    );
    const modifiers = normalizeMouseModifiers(options.modifiers);
    const operations = Object.freeze<DeviceOperation[]>([
      Object.freeze({ device: 'mouse', kind: 'down', button: 'left', modifiers, ...from.point }),
      ...unique.map((point) => Object.freeze<DeviceOperation>({
        device: 'mouse', kind: 'move', button: 'left', modifiers, ...point,
      })),
      Object.freeze({ device: 'mouse', kind: 'up', button: 'left', modifiers, ...to.point }),
    ]);
    return Object.freeze({
      point: from.point,
      plan: Object.freeze({
        ...from.plan,
        intent: { ...intent, targetRef: source.ref },
        requirements: Object.freeze([...from.plan.requirements, ...to.plan.requirements]),
        strategy: `${from.plan.strategy}-to-${to.plan.strategy}-stepped-drag`,
        operations,
      }),
    });
  }

  explainPointer(intent: ActionIntent, target: ResolvedTarget, options?: PointerOptions): ActionabilityExplanation {
    return this.explain(intent, target, options);
  }

  /** Runs the exact production planner without executing device operations. */
  explain(
    intent: ActionIntent,
    target: ResolvedTarget,
    options?: PointerOptions,
    value = '',
  ): ActionabilityExplanation {
    try {
      const plan = intent.kind === 'click' || intent.kind === 'double-click' || intent.kind === 'hover'
        ? this.planPointer('explain', intent, target, options).plan
        : this.planKeyboard('explain', intent, target, value);
      return Object.freeze({ actionable: true, intent, checkpoint: plan.checkpoint, requirements: plan.requirements, strategy: plan.strategy });
    } catch (error) {
      const checkpoint = this.#ctx.checkpoint();
      return Object.freeze({
        actionable: false,
        intent,
        checkpoint,
        requirements: this.#lastRequirements,
        reason: Object.freeze({
          code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
          message: error instanceof Error ? error.message : String(error),
          ...(intent.targetRef === undefined ? {} : { targetRef: intent.targetRef }),
        }),
      });
    }
  }

  #operations(intent: ActionIntent, point: { row: number; column: number }, options?: PointerOptions): readonly DeviceOperation[] {
    const button = options?.button ?? 'left';
    const modifiers = normalizeMouseModifiers(options?.modifiers);
    if (intent.kind === 'hover') return Object.freeze([{ device: 'mouse', kind: 'move', modifiers, ...point }]);
    const clicks = intent.kind === 'double-click' ? 2 : 1;
    return Object.freeze(Array.from({ length: clicks }, () => [
      Object.freeze<DeviceOperation>({ device: 'mouse', kind: 'down', button, modifiers, ...point }),
      Object.freeze<DeviceOperation>({ device: 'mouse', kind: 'up', button, modifiers, ...point }),
    ]).flat());
  }

  #wheelDelta(value: number, name: 'deltaX' | 'deltaY'): number {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`locator.wheel() ${name} must be a safe integer, received ${String(value)}`);
    }
    if (Math.abs(value) > 100) throw new RangeError('locator.wheel() accepts at most 100 steps per axis');
    return value;
  }

  #point(
    point: { readonly row: number; readonly column: number },
    api: string,
  ): { readonly row: number; readonly column: number } {
    if (!Number.isSafeInteger(point.row) || point.row < 0 ||
        !Number.isSafeInteger(point.column) || point.column < 0) {
      throw new TypeError(`${api} coordinates must be non-negative safe integers, received (${point.row}, ${point.column})`);
    }
    return Object.freeze({ row: point.row, column: point.column });
  }

  #capabilityBoolean(
    capability: keyof EffectiveSessionContract['capabilities'],
    value: boolean,
  ): Observation<boolean> {
    const availability = this.#ctx.contract()?.capabilities[capability];
    return availability?.status === 'supported'
      ? Object.freeze({ status: 'known', value, evidence: availability.evidence })
      : Object.freeze({ status: 'unsupported', capability, reason: availability?.reason === 'framework-unobservable' ? 'framework-unobservable' : availability?.reason === undefined || availability.reason === 'not-negotiated' ? 'not-negotiated' : 'capability' });
  }

  #requireCapability(
    capability: keyof EffectiveSessionContract['capabilities'],
    message: string,
    diagnostics: ErrorDiagnostics,
  ): void {
    if (this.#ctx.contract()?.capabilities[capability].status !== 'supported') {
      throw new CapabilityUnavailableError(message, diagnostics);
    }
  }

  #remember(requirements: readonly ConditionResult[]): void {
    this.#lastRequirements = Object.freeze([...requirements]);
  }

  #attachFailure(error: unknown, intent: ActionIntent): unknown {
    if (!(error instanceof TermwrightError)) return error;
    const checkpoint = this.#lastRequirements[0]?.checkpoint ?? this.#lastCheckpoint ?? this.#ctx.checkpoint();
    return error.withActionability(Object.freeze({
      actionable: false,
      intent,
      checkpoint,
      requirements: this.#lastRequirements,
      reason: Object.freeze({
        code: error.code,
        message: error.message,
        ...(intent.targetRef === undefined ? {} : { targetRef: intent.targetRef }),
      }),
    }));
  }
}
