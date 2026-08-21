import type { EvidenceProvenance } from './contract.js';
import type { Observation, ObservationStamp } from './observation.js';
import type { Rect } from './tree.js';

/** Closed vocabulary shared by action planning, traces, Runner and MCP. */
export const CONDITION_KINDS = Object.freeze([
  'attached', 'detached', 'displayed', 'hidden', 'visible', 'in-viewport', 'offscreen',
  'receives-pointer', 'pointer-region', 'pointer-input', 'mouse-input-enabled',
  'enabled', 'disabled', 'focused', 'checked', 'selected', 'expanded', 'collapsed',
  'value', 'not', 'all', 'any',
] as const);

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
  readonly targetRef?: string;
}

export type DeviceOperation =
  | { readonly device: 'keyboard'; readonly kind: 'press' | 'type' | 'paste'; readonly value: string }
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

export interface ActionPlan {
  readonly actionId: string;
  readonly contractId: string;
  readonly intent: ActionIntent;
  readonly checkpoint: ObservationStamp;
  readonly requirements: readonly ConditionResult[];
  readonly strategy: string;
  readonly physicalRegion?: PhysicalRegion;
  readonly operations: readonly DeviceOperation[];
}

export interface ActionabilityExplanation {
  readonly actionable: boolean;
  readonly intent: ActionIntent;
  readonly checkpoint: ObservationStamp;
  readonly requirements: readonly ConditionResult[];
  readonly strategy?: string;
  readonly reason?: { readonly code: string; readonly message: string; readonly targetRef?: string };
}

export interface ActionReceipt {
  readonly intent: ActionIntent;
  readonly plan: ActionPlan;
  readonly before: ObservationStamp;
  readonly after: ObservationStamp;
  readonly executed: readonly DeviceOperation[];
  readonly outcome: 'completed' | 'partial' | 'failed';
}
