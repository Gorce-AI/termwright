/**
 * The field names of a semantic node and of its state, as data.
 *
 * These exist because a schema is invisible to anything that is not TypeScript.
 * The cross-language vector generator and the client comparators cannot see a
 * zod shape, so until now they carried hand-maintained field lists — and three
 * fields (`frameworkType`, `occlusion`, `p`/`px`) reached three clients late
 * precisely because nobody remembered to extend those lists. A generator that
 * reads this array cannot forget a field the schema already has.
 *
 * Derived from the schema rather than written out, so there is one source of
 * truth and not a third copy to drift. The list does not vary with limits: only
 * the bounds inside the fields do.
 */

import { DEFAULT_LIMITS } from './limits.js';
import { treeSchemas } from './node-schema.js';
import type { SemanticNode, SemanticState } from './tree.js';

const schemas = treeSchemas(DEFAULT_LIMITS);

/**
 * Every field name on `SemanticNode`.
 *
 * The `keyof` annotation is the load-bearing part: a field present in the
 * schema but missing from the interface fails to compile here, which is the
 * half of the drift a runtime test cannot catch early.
 */
export const SEMANTIC_NODE_KEYS: readonly (Exclude<keyof SemanticNode, 'geometry'>)[] = Object.freeze(
  schemas.nodeKeys as readonly (Exclude<keyof SemanticNode, 'geometry'>)[],
);

/** Every field name on `SemanticState`. */
export const SEMANTIC_STATE_KEYS: readonly (keyof SemanticState)[] = Object.freeze(
  schemas.stateKeys as readonly (keyof SemanticState)[],
);
