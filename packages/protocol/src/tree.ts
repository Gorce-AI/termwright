import type { SemanticAction, SemanticRole } from './roles.js';
import type { ProvenanceSource } from './probe/ir.js';
import type { CoordinateSpace, Observation, SemanticValueObservation } from './observation.js';
import type { EvidenceProvenance } from './contract.js';

/** Zero-based viewport cell coordinates. */
export interface Rect {
  readonly row: number;
  readonly column: number;
  readonly width: number;
  readonly height: number;
}

/** Closed state set. No arbitrary records. */
export interface SemanticState {
  readonly disabled?: boolean;
  readonly focused?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly expanded?: boolean;
  readonly modal?: boolean;
  readonly busy?: boolean;
  readonly hidden?: boolean;
  /**
   * The node exists in the layout, but every one of its cells falls outside the
   * visible area — it is scrolled out, and scrolling can bring it back.
   *
   * Named for the claim a test author makes ("this row is off screen"), not for
   * the mechanism that produced it. Clipping is how it happens; being off
   * screen is what it means.
   *
   * **Absent means "not claiming"**, not "on screen". A producer that cannot
   * observe clipping simply omits it. Evidence-qualified geometry remains the
   * authoritative source for viewport and visibility assertions.
   *
   * Implies {@link SemanticState.hidden}: if every cell is outside the visible
   * area then the node is not visible, and validation refuses the pair
   * `offscreen: true` without `hidden: true`.
   */
  readonly offscreen?: boolean;
  readonly readonly?: boolean;
  readonly multiline?: boolean;
  readonly required?: boolean;
  readonly multiselectable?: boolean;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly level?: number;
  readonly positionInSet?: number;
  readonly setSize?: number;
}

/** Authoritative application viewport state in production-defined logical units. */
export interface SemanticScrollState {
  readonly axis: 'vertical' | 'horizontal';
  /** Logical distance from the start of the scrollable content. */
  readonly offset: number;
  /** Logical size of the visible application viewport. */
  readonly viewport: number;
  /** Logical size of the complete scrollable content. */
  readonly extent: number;
}

/** Exact viewport cells painted by one semantic recipient for a committed frame. */
export interface SemanticPaintedRegion {
  /** Bounding box of the painted cells; this is not intended layout geometry. */
  readonly regionBounds: Rect;
  /** Canonical, non-overlapping half-open row runs. */
  readonly spans: readonly { readonly row: number; readonly from: number; readonly to: number }[];
}

/** Maps grapheme offsets of a node's text to cell coordinates (optional capability). */
export interface SemanticTextRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly rect: Rect;
}

/**
 * Deterministic JSON data owned by the application domain, not by the portable
 * semantic vocabulary. Containers are allowed, but runtime objects/functions
 * are not; validation applies the protocol's normal depth, byte and collection
 * ceilings recursively.
 */
export interface SemanticExtendedArray extends ReadonlyArray<SemanticExtendedValue> {}

export interface SemanticExtendedObject {
  readonly [key: string]: SemanticExtendedValue;
}

export type SemanticExtendedValue =
  null | boolean | number | string | SemanticExtendedArray | SemanticExtendedObject;

/** Application-defined state, deliberately separate from {@link SemanticState}. */
export type SemanticExtendedState = SemanticExtendedObject;

export interface SemanticNode {
  readonly id: string;
  readonly parentId?: string;
  readonly role: SemanticRole;
  readonly name: string;
  readonly description?: string;
  readonly value?: SemanticValueObservation;
  readonly state?: SemanticState;
  /** Application-specific, serializable state; never promoted to portable flags. */
  readonly extended?: SemanticExtendedState;
  readonly actions?: readonly SemanticAction[];
  /** Authoritative recipe executed only through Termwright's real input devices. */
  readonly inputRecipes?: readonly import('./roles.js').PhysicalInputRecipe[];
  readonly labelledBy?: readonly string[];
  readonly describedBy?: readonly string[];
  readonly textRanges?: readonly SemanticTextRange[];
  /** Author-supplied test id (getByTestId). */
  readonly testId?: string;
  /**
   * The framework's own name for this widget — a class name, a constructor
   * name, a widget type.
   *
   * **Required when `role` is `generic`.** An unrecognised widget must survive
   * as a generic node keeping its geometry, text and children, instead of being
   * dropped with its children reparented. `frameworkType` is what makes such a
   * node identifiable: without it a generic node says only "something was
   * here", which is barely better than the drop it replaced.
   */
  readonly frameworkType?: string;
  /** True when this node may own children the framework probe cannot enumerate. */
  readonly opaqueChildren?: boolean;
  /**
   * Provenance: where this node's facts came from.
   *
   * One source for the whole node, because node facts overwhelmingly share
   * one. Exceptions go in {@link SemanticNode.px}, so a mixed node pays only
   * for the fields that actually differ. Descriptive per-property strings were
   * ruled out by arithmetic — they cost about +91 % against a budget that is
   * already tight.
   */
  readonly p?: ProvenanceSource;
  /** Per-field provenance, for fields whose source differs from `p`. */
  readonly px?: Readonly<Record<string, ProvenanceSource>>;
  /** Evidence-qualified layout facts for this committed observation. */
  readonly geometry: NodeGeometryObservations;
  /** Application scroll state; distinct from the terminal emulator's scrollback. */
  readonly scroll?: Observation<SemanticScrollState>;
  /** Authoritative paint provenance; distinct from layout, clipping and pointer routing. */
  readonly paintedRegion?: Observation<SemanticPaintedRegion>;
}

/** Layout facts reported independently so absence never masquerades as false. */
export interface NodeGeometryObservations {
  readonly displayed: Observation<boolean>;
  readonly intendedRect: Observation<Rect>;
  readonly visibleRect: Observation<Rect>;
}

/** One half-open run of cells with an exact pointer recipient. */
export interface PointerHitRegion {
  /** Canonical non-empty row run: `height` is always 1. */
  readonly rect: Rect;
  readonly recipientId: string;
}

/** A complete point-ownership map for a committed frame. */
export interface PointerHitGrid {
  readonly regions: readonly PointerHitRegion[];
}

/** One provider-owned target region for a committed application revision. */
export interface ProviderPointerRegion {
  readonly recipientId: string;
  /** Bounding box of the pointer-receiving cells; not layout geometry. */
  readonly regionBounds: Rect;
  /** Canonical non-overlapping visible cell runs owned by the target. */
  readonly spans: readonly { readonly row: number; readonly from: number; readonly to: number }[];
}

/** Revision-bound application strategy recipes for one semantic recipient. */
export interface ProviderActionRecipes {
  readonly recipientId: string;
  readonly recipes: readonly import('./roles.js').PhysicalInputRecipe[];
}

/** Revision-bound application viewport state for one semantic recipient. */
export interface ProviderScrollState extends SemanticScrollState {
  readonly recipientId: string;
}

/** Revision-bound application paint provenance for one semantic recipient. */
export interface ProviderPaintedRegion extends SemanticPaintedRegion {
  readonly recipientId: string;
}

/** Production parser configuration hidden by the terminal transport. */
export interface ProviderTerminalInputModes {
  readonly mouseTracking: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  readonly mouseEncoding: 'default' | 'sgr' | 'urxvt' | 'utf8';
  readonly focusReporting: 'on' | 'off';
}

/** Exact production focus-manager result for one committed revision. */
export type ProviderFocusState =
  { readonly status: 'focused'; readonly recipientId: string } | { readonly status: 'none' };

/**
 * Application evidence bound to the same revision as its containing snapshot.
 * A provider announced in hello must contribute exactly one entry per frame.
 */
export type ProviderRevisionEvidence =
  | {
      readonly providerId: string;
      readonly sessionId: string;
      readonly revision: number;
      readonly status: 'available';
      readonly evidence: EvidenceProvenance;
      readonly pointerRegions: readonly ProviderPointerRegion[];
      /** Exact production focus-manager result when `focus-state` was announced. */
      readonly focusState?: ProviderFocusState;
      /** Production keybinding recipes when `action-recipes` was announced. */
      readonly actionRecipes?: readonly ProviderActionRecipes[];
      /** Complete application viewport facts when `scroll-state` was announced. */
      readonly scrollStates?: readonly ProviderScrollState[];
      /** Complete paint attribution when `painted-regions` was announced. */
      readonly paintedRegions?: readonly ProviderPaintedRegion[];
      /** Production parser configuration when `terminal-input-modes` was announced. */
      readonly inputModes?: ProviderTerminalInputModes;
      /** Complete production-router ownership map when `hit-test` was announced. */
      readonly hitGrid?: PointerHitGrid;
    }
  | {
      readonly providerId: string;
      readonly sessionId: string;
      readonly revision: number;
      readonly status: 'lost';
      readonly reason: string;
    }
  | {
      readonly providerId: string;
      readonly sessionId: string;
      readonly revision: number;
      readonly status: 'violation';
      readonly reason: string;
    };

export interface CursorInfo {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
  readonly shape?: 'block' | 'underline' | 'bar';
}

export interface SemanticSnapshot {
  readonly v: 2;
  readonly sessionId: string;
  /** Positive, strictly increasing within a semantic session. */
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  readonly cursor?: CursorInfo;
  readonly rootIds: readonly string[];
  readonly nodes: readonly SemanticNode[];
  /** Coordinate system used by every physical observation in this snapshot. */
  readonly coordinateSpace: Observation<CoordinateSpace>;
  /**
   * Required by v2. `known` means a complete map, not a sample or paint-order
   * approximation. Cells absent from a known map have no semantic recipient.
   */
  readonly hitGrid: Observation<PointerHitGrid>;
  /** Present only when application evidence providers were negotiated in hello. */
  readonly providerEvidence?: readonly ProviderRevisionEvidence[];
}
