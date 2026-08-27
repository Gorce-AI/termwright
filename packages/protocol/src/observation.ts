import type { Rect } from './tree.js';
import type { EvidenceProvenance } from './contract.js';

/**
 * Why a fact is temporarily unsettled.
 *
 * Every value names a revision-domain retry boundary. Permanent inability to
 * observe a fact is `unsupported`, never `unknown`.
 */
export type ObservationUnknownReason =
  'awaiting-revision-pair' | 'provider-refresh' | 'stale-revision';

export type ObservationAbsentReason = 'detached' | 'not-displayed' | 'not-laid-out';

export type ObservationUnsupportedReason =
  'capability' | 'framework-unobservable' | 'not-negotiated';

export type ObservationEvidence = EvidenceProvenance;
export type AuthoritativeObservationEvidence = ObservationEvidence & {
  readonly strength: 'authoritative';
};

/**
 * A fact with its epistemic state preserved.
 *
 * Consumers must never coerce `unknown`/`unsupported` to false, nor absence to
 * an empty value. That rule prevents assertions from passing because a probe
 * simply could not observe the requested property.
 */
export type Observation<T> =
  | { readonly status: 'known'; readonly value: T; readonly evidence: ObservationEvidence }
  | {
      readonly status: 'absent';
      readonly reason: ObservationAbsentReason;
      readonly evidence: AuthoritativeObservationEvidence;
    }
  | { readonly status: 'unknown'; readonly reason: ObservationUnknownReason }
  | {
      readonly status: 'unsupported';
      readonly capability: string;
      readonly reason: ObservationUnsupportedReason;
    };

export type SemanticValueAbsentReason = ObservationAbsentReason | 'no-value';
export type SemanticValueWithheldReason = 'sensitive' | 'artifact-policy' | 'provider-policy';

/** A semantic value never collapses absence, uncertainty, support or confidentiality. */
export type SemanticValueObservation =
  | {
      readonly status: 'known';
      readonly value: string;
      readonly sensitivity: 'public' | 'sensitive';
      readonly evidence: ObservationEvidence;
    }
  | {
      readonly status: 'absent';
      readonly reason: SemanticValueAbsentReason;
      readonly evidence: AuthoritativeObservationEvidence;
    }
  | { readonly status: 'unknown'; readonly reason: ObservationUnknownReason }
  | {
      readonly status: 'unsupported';
      readonly capability: 'semantic-value';
      readonly reason: ObservationUnsupportedReason;
    }
  | {
      readonly status: 'withheld';
      readonly reason: SemanticValueWithheldReason;
      readonly sensitivity: 'public' | 'sensitive';
    };

/** Atomic identity of the screen/tree pair used for an observation. */
export interface ObservationStamp {
  readonly sessionId: string;
  readonly contractId: string;
  readonly epoch: number;
  /** Monotonic publication order across both screen and semantic revisions. */
  readonly sequence: number;
  readonly screenRevision: number;
  readonly semanticRevision: number | null;
  /** Screen revision paired to semanticRevision, or null when no pair exists. */
  readonly pairedScreenRevision: number | null;
}

export type CoordinateSpace = 'viewport-cells' | 'framework-local-cells';

export interface LocatorGeometry {
  readonly stamp: ObservationStamp;
  readonly coordinateSpace: Observation<CoordinateSpace>;
  readonly intendedRect: Observation<Rect>;
  readonly visibleRect: Observation<Rect>;
}

export interface ViewportIntersection {
  /** Half-open intersection in viewport cell coordinates. */
  readonly rect: Rect;
  /** Intersection area / intended area. Zero-area intended rect has ratio 0. */
  readonly ratio: number;
  readonly fullyInside: boolean;
}

export interface LocatorVisibility {
  readonly stamp: ObservationStamp;
  readonly attached: Observation<boolean>;
  readonly displayed: Observation<boolean>;
  readonly viewport: Observation<ViewportIntersection>;
  readonly offscreen: Observation<boolean>;
}

export interface CellPoint {
  readonly row: number;
  readonly column: number;
}

export interface PointerHitTest {
  readonly stamp: ObservationStamp;
  readonly point: Observation<CellPoint>;
  readonly receivesEvents: Observation<boolean>;
  /** Ref of the actual recipient, when the producer can identify it. */
  readonly recipient: Observation<string>;
}

export type SpatialRelation =
  | 'contains'
  | 'inside'
  | 'overlaps'
  | 'left-of'
  | 'right-of'
  | 'above'
  | 'below'
  | 'aligned-left'
  | 'aligned-right'
  | 'aligned-top'
  | 'aligned-bottom'
  | 'adjacent-horizontal'
  | 'adjacent-vertical';

/** Correct half-open rectangle intersection. Touching edges do not overlap. */
export function intersectRects(a: Rect, b: Rect): Rect {
  const row = Math.max(a.row, b.row);
  const column = Math.max(a.column, b.column);
  return {
    row,
    column,
    width: Math.max(0, Math.min(a.column + a.width, b.column + b.width) - column),
    height: Math.max(0, Math.min(a.row + a.height, b.row + b.height) - row),
  };
}

export function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function viewportIntersection(
  rect: Rect,
  columns: number,
  rows: number,
): ViewportIntersection {
  const intersection = intersectRects(rect, { row: 0, column: 0, width: columns, height: rows });
  const area = rectArea(rect);
  const visible = rectArea(intersection);
  return Object.freeze({
    rect: Object.freeze(intersection),
    ratio: area === 0 ? 0 : visible / area,
    fullyInside: area > 0 && visible === area,
  });
}

export function spatialRelation(a: Rect, relation: SpatialRelation, b: Rect): boolean {
  const aBottom = a.row + a.height;
  const bBottom = b.row + b.height;
  const aRight = a.column + a.width;
  const bRight = b.column + b.width;
  switch (relation) {
    case 'contains':
      return a.row <= b.row && a.column <= b.column && aBottom >= bBottom && aRight >= bRight;
    case 'inside':
      return spatialRelation(b, 'contains', a);
    case 'overlaps':
      return rectArea(intersectRects(a, b)) > 0;
    case 'left-of':
      return aRight <= b.column;
    case 'right-of':
      return bRight <= a.column;
    case 'above':
      return aBottom <= b.row;
    case 'below':
      return bBottom <= a.row;
    case 'aligned-left':
      return a.column === b.column;
    case 'aligned-right':
      return aRight === bRight;
    case 'aligned-top':
      return a.row === b.row;
    case 'aligned-bottom':
      return aBottom === bBottom;
    case 'adjacent-horizontal':
      return (
        (aRight === b.column || bRight === a.column) &&
        Math.max(a.row, b.row) < Math.min(aBottom, bBottom)
      );
    case 'adjacent-vertical':
      return (
        (aBottom === b.row || bBottom === a.row) &&
        Math.max(a.column, b.column) < Math.min(aRight, bRight)
      );
  }
}
