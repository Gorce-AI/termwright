import type { EvidenceProvenance } from './contract.js';
import type { Observation, ObservationStamp } from './observation.js';
import type { Rect } from './tree.js';
import {
  recordValue,
  type ArtifactValuePolicy,
  type ExecutableValue,
  type RecordedValue,
} from './artifact-safety.js';

/** Closed vocabulary shared by action planning, traces, Runner and MCP. */
export { CONDITION_KINDS } from './capability-graph.js';
export type { ConditionKind } from './capability-graph.js';

export type LocatorDomain = 'semantic' | 'screen';
export type SemanticLocatorRef = `semantic:${string}@${number}`;
export type ScreenLocatorRef = `screen:${number},${number},${number},${number}@${number}`;
export type LocatorRef = SemanticLocatorRef | ScreenLocatorRef;

export type ConditionTextMatcher =
  | { readonly kind: 'exact' | 'substring'; readonly text: string }
  | { readonly kind: 'regex'; readonly source: string; readonly flags: string };

export type Condition =
  | { readonly kind: 'attached'; readonly target: string }
  | { readonly kind: 'detached'; readonly target: string }
  | { readonly kind: 'displayed'; readonly target: string }
  | { readonly kind: 'hidden'; readonly target: string }
  | { readonly kind: 'visible'; readonly target: string }
  | { readonly kind: 'in-viewport'; readonly target: string; readonly minRatio: number }
  | { readonly kind: 'offscreen'; readonly target: string }
  | { readonly kind: 'receives-pointer'; readonly target: string }
  | { readonly kind: 'pointer-region'; readonly target: string }
  | { readonly kind: 'pointer-input'; readonly target: string }
  | { readonly kind: 'mouse-input-enabled'; readonly target: string }
  | { readonly kind: 'enabled'; readonly target: string }
  | { readonly kind: 'disabled'; readonly target: string }
  | { readonly kind: 'focused'; readonly target: string }
  | { readonly kind: 'checked'; readonly target: string; readonly value: boolean }
  | { readonly kind: 'selected'; readonly target: string; readonly value: boolean }
  | { readonly kind: 'expanded'; readonly target: string; readonly value: boolean }
  | { readonly kind: 'collapsed'; readonly target: string }
  | { readonly kind: 'value'; readonly target: string; readonly matcher: ConditionTextMatcher }
  | { readonly kind: 'not'; readonly condition: Condition }
  | { readonly kind: 'all' | 'any'; readonly conditions: readonly Condition[] };

export type ScreenLeafCondition = Extract<
  Condition,
  {
    readonly kind:
      | 'attached'
      | 'detached'
      | 'displayed'
      | 'hidden'
      | 'visible'
      | 'in-viewport'
      | 'offscreen'
      | 'receives-pointer'
      | 'pointer-region'
      | 'pointer-input'
      | 'mouse-input-enabled';
  }
>;
export type ScreenCondition =
  | ScreenLeafCondition
  | { readonly kind: 'not'; readonly condition: ScreenCondition }
  | { readonly kind: 'all' | 'any'; readonly conditions: readonly ScreenCondition[] };

export interface ConditionResult {
  readonly condition: Condition;
  readonly checkpoint: ObservationStamp;
  readonly observation: Observation<boolean>;
  readonly verdict: 'satisfied' | 'unsatisfied' | 'inconclusive';
}

/** A disjoint physical region represented as canonical, non-overlapping row spans. */
export interface PhysicalRegion {
  readonly checkpoint: ObservationStamp;
  readonly coordinateSpace: 'viewport-cells';
  readonly intendedRect: Rect;
  readonly spans: readonly { readonly row: number; readonly from: number; readonly to: number }[];
  readonly evidence: EvidenceProvenance;
}

export type ActionKind =
  | 'click'
  | 'double-click'
  | 'hover'
  | 'drag'
  | 'focus'
  | 'activate'
  | 'press'
  | 'type'
  | 'paste'
  | 'fill'
  | 'check'
  | 'uncheck'
  | 'wheel'
  | 'shell-command'
  | 'resize';

export interface ActionIntent {
  readonly kind: ActionKind;
  readonly selector?: string;
  readonly targetRef?: LocatorRef;
}

export type ExecutableDeviceOperation =
  | {
      readonly device: 'keyboard';
      readonly kind: 'press' | 'type' | 'paste';
      readonly value: ExecutableValue;
    }
  | {
      readonly device: 'mouse';
      readonly kind: 'move' | 'down' | 'up' | 'wheel';
      readonly row: number;
      readonly column: number;
      readonly button?: 'left' | 'middle' | 'right';
      readonly modifiers?: readonly ('shift' | 'alt' | 'control')[];
      readonly deltaX?: number;
      readonly deltaY?: number;
    };

export type RecordedDeviceOperation =
  | {
      readonly device: 'keyboard';
      readonly kind: 'press' | 'type' | 'paste';
      readonly value: RecordedValue;
    }
  | Exclude<ExecutableDeviceOperation, { readonly device: 'keyboard' }>;

/** Runtime-only plan. It must be projected before crossing an artifact boundary. */
export interface ExecutableActionPlan {
  readonly actionId: string;
  readonly contractId: string;
  readonly intent: ActionIntent;
  readonly checkpoint: ObservationStamp;
  readonly requirements: readonly ConditionResult[];
  readonly strategy: string;
  readonly physicalRegion?: PhysicalRegion;
  readonly operations: readonly ExecutableDeviceOperation[];
}

export interface ActionPlan {
  readonly actionId: string;
  readonly contractId: string;
  readonly intent: ActionIntent;
  readonly checkpoint: ObservationStamp;
  readonly requirements: readonly ConditionResult[];
  readonly strategy: string;
  readonly physicalRegion?: PhysicalRegion;
  readonly operations: readonly RecordedDeviceOperation[];
  readonly valuePolicy: ArtifactValuePolicy;
}

export interface ActionabilityExplanation {
  readonly actionable: boolean;
  readonly intent: ActionIntent;
  readonly checkpoint: ObservationStamp;
  readonly requirements: readonly ConditionResult[];
  readonly strategy?: string;
  readonly reason?: {
    readonly code: string;
    readonly message: string;
    readonly targetRef?: LocatorRef;
  };
}

export interface ActionReceipt {
  readonly intent: ActionIntent;
  readonly plan: ActionPlan;
  readonly before: ObservationStamp;
  readonly after: ObservationStamp;
  readonly executed: readonly RecordedDeviceOperation[];
  readonly outcome: 'completed' | 'partial' | 'failed';
}

export function recordDeviceOperation(
  operation: ExecutableDeviceOperation,
  policy: ArtifactValuePolicy,
): RecordedDeviceOperation {
  if (operation.device === 'mouse') return Object.freeze({ ...operation });
  if (operation.kind === 'press' && typeof operation.value === 'string') {
    return Object.freeze({
      ...operation,
      value: Object.freeze({
        status: 'known',
        value: executableTextForPress(operation.value),
        sensitivity: 'public',
      }),
    });
  }
  return Object.freeze({ ...operation, value: recordValue(operation.value, policy) });
}

function executableTextForPress(value: ExecutableValue): string {
  return typeof value === 'string' ? value : value.value;
}

export function recordActionPlan(
  plan: ExecutableActionPlan,
  policy: ArtifactValuePolicy,
): ActionPlan {
  return Object.freeze({
    ...plan,
    operations: Object.freeze(
      plan.operations.map((operation) => recordDeviceOperation(operation, policy)),
    ),
    valuePolicy: policy,
  });
}

export function projectActionReceiptForArtifact(
  receipt: ActionReceipt,
  policy: ArtifactValuePolicy,
): ActionReceipt {
  const project = (operation: RecordedDeviceOperation): RecordedDeviceOperation => {
    if (operation.device === 'mouse' || operation.value.status === 'withheld') return operation;
    if (operation.kind === 'press' && operation.value.sensitivity === 'public') return operation;
    if (policy === 'raw' || (policy === 'redacted' && operation.value.sensitivity === 'public'))
      return operation;
    return Object.freeze({
      ...operation,
      value: Object.freeze({
        status: 'withheld' as const,
        reason: 'artifact-policy' as const,
        sensitivity: operation.value.sensitivity,
      }),
    });
  };
  const plan = Object.freeze({
    ...receipt.plan,
    valuePolicy: policy,
    operations: Object.freeze(receipt.plan.operations.map(project)),
  });
  return Object.freeze({
    ...receipt,
    plan,
    executed: Object.freeze(receipt.executed.map(project)),
  });
}
