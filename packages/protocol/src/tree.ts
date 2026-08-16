import type { SemanticAction, SemanticRole } from './roles.js';
import type { ProvenanceSource } from './probe/ir.js';
import type { OcclusionKnowledge } from './probe/bounds.js';

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
}

export interface CursorInfo {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
  readonly shape?: 'block' | 'underline' | 'bar';
}

export interface SemanticSnapshot {
  readonly v: 1;
  readonly sessionId: string;
  /** Positive, strictly increasing within a semantic session. */
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  readonly cursor?: CursorInfo;
  readonly rootIds: readonly string[];
  readonly nodes: readonly SemanticNode[];
}
