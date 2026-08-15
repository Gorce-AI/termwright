/**
 * Registry of author annotations, keyed by the Ink DOM element behind a ref.
 *
 * Entries are held weakly: an unmounted element is collectable even if a
 * component forgot to unregister. The registry is created per semantic session,
 * so a dormant process never allocates one.
 */

import type { DOMElement } from 'ink';
import type { SemanticMeta } from './types.js';

/** Weak, per-session store of `useSemantic` annotations. */
export class SemanticRegistry {
  readonly #entries = new WeakMap<DOMElement, SemanticMeta>();

  /**
   * Record (or replace) the annotation for an element.
   *
   * @returns a disposer that removes the annotation again.
   */
  register(node: DOMElement, meta: SemanticMeta): () => void {
    this.#entries.set(node, meta);
    return () => {
      if (this.#entries.get(node) === meta) this.#entries.delete(node);
    };
  }

  /** Look up the annotation for an element, if any. */
  get(node: DOMElement): SemanticMeta | undefined {
    return this.#entries.get(node);
  }
}
