import type { SemanticSnapshot } from './tree.js';
import type { ProtocolLimits } from './limits.js';

/** Structured result: never throws hostile data onward. */
export type ValidationResult =
  | { readonly ok: true; readonly snapshot: SemanticSnapshot }
  | { readonly ok: false; readonly code: ValidationErrorCode; readonly detail: string };

export type ValidationErrorCode =
  | 'schema'
  | 'unknown-role'
  | 'duplicate-id'
  | 'missing-parent'
  | 'cycle'
  | 'depth'
  | 'count'
  | 'string-bytes'
  | 'bad-rect'
  | 'revision'
  | 'bytes';

/**
 * Full snapshot validation per spec §8.2: unique ids, existing+acyclic parent
 * relations, dense bounded arrays, Unicode scalar strings within byte bounds,
 * safe-integer rects intersecting the viewport unless state.hidden, strictly
 * increasing revisions (checked by caller against session state), deep
 * immutability of the returned value.
 */
export declare function validateSnapshot(
  value: unknown,
  limits: ProtocolLimits,
): ValidationResult;
