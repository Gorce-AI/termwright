import type { SemanticAction, SemanticRole } from './roles.js';
import type { ProvenanceSource } from './probe/ir.js';
import type { OcclusionKnowledge } from './probe/bounds.js';
import type { CoordinateSpace, Observation } from './observation.js';

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
   * observe clipping simply omits it, which is why this is a positive
   * assertion rather than a tri-state.
   *
   * It exists so that `bounds: undefined` keeps its single meaning — "this
   * producer does not know the geometry". Before this field, an adapter had to
   * choose between saying "no geometry" and saying "scrolled away", and those
   * are different facts that a consumer reading a tree generically could not
   * tell apart.
   *
   * Implies {@link SemanticState.hidden}: if every cell is outside the visible
   * area then the node is not visible, and validation refuses the pair
   * `offscreen: true` without `hidden: true`.
   */
  readonly offscreen?: boolean;
  readonly readonly?: boolean;
  readonly multiline?: boolean;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly level?: number;
  readonly positionInSet?: number;
  readonly setSize?: number;
  readonly scrollOffset?: number;
  readonly scrollExtent?: number;
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
  | null
  | boolean
  | number
  | string
  | SemanticExtendedArray
  | SemanticExtendedObject;

/** Application-defined state, deliberately separate from {@link SemanticState}. */
export type SemanticExtendedState = SemanticExtendedObject;

export interface SemanticNode {
  readonly id: string;
  readonly parentId?: string;
  readonly role: SemanticRole;
  readonly name: string;
  readonly description?: string;
  readonly value?: string;
  /**
   * The node's **visible** geometry, guaranteed.
   *
   * Normalizers resolve this to the best known visible rectangle — the clip
   * intersection where a framework computes one, `intendedRect ∩ clip` where a
   * clip is known, and the intended rectangle only as a last resort. A consumer
   * therefore never has to ask which rectangle it is holding.
   *
   * Still optional: class-B/C frameworks publish nodes without trustworthy
   * coordinates, and one framework hands over a rendered string with no
   * geometry anywhere. Absent bounds is a normal state, not a degraded one.
   */
  readonly bounds?: Rect;
  /**
   * Whether it is knowable that something else was painted over this node.
   *
   * `bounds` says where the node is; it does not say whether a pointer aimed
   * there reaches it. Only some frameworks expose paint order, so this is
   * `'known'` only when the probe reported it. **Absent means `'unknown'`** —
   * the conservative value is the default, so a producer has to claim
   * knowledge rather than have it assumed.
   *
   * A consumer performing pointer actions should refuse on `'unknown'` rather
   * than click and hope: the input lands somewhere real, and if it lands on
   * another widget the result is attributed to this one. That is a silent
   * false green, which is a worse failure than a refusal.
   */
  readonly occlusion?: OcclusionKnowledge;
  readonly state?: SemanticState;
  /** Application-specific, serializable state; never promoted to portable flags. */
  readonly extended?: SemanticExtendedState;
  readonly actions?: readonly SemanticAction[];
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
   * as a generic node keeping its bounds, text and children, instead of being
   * dropped with its children reparented. `frameworkType` is what makes such a
   * node identifiable: without it a generic node says only "something was
   * here", which is barely better than the drop it replaced.
   */
  readonly frameworkType?: string;
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
  /**
   * Protocol v2 qualified layout facts. V1 snapshots MUST omit this field;
   * their legacy `bounds` projection deliberately remains unchanged.
   */
  readonly geometry?: NodeGeometryObservations;
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

export interface CursorInfo {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
  readonly shape?: 'block' | 'underline' | 'bar';
}

export interface SemanticSnapshot {
  readonly v: 1 | 2;
  readonly sessionId: string;
  /** Positive, strictly increasing within a semantic session. */
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  readonly cursor?: CursorInfo;
  readonly rootIds: readonly string[];
  readonly nodes: readonly SemanticNode[];
  /** Required by v2, forbidden by strict v1 validation. */
  readonly coordinateSpace?: Observation<CoordinateSpace>;
  /**
   * Required by v2. `known` means a complete map, not a sample or paint-order
   * approximation. Cells absent from a known map have no semantic recipient.
   */
  readonly hitGrid?: Observation<PointerHitGrid>;
}
