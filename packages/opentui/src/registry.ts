/**
 * Registry of author annotations, keyed by the renderable they describe.
 *
 * Entries are held weakly: a destroyed renderable is collectable even if the
 * application forgot to unregister it. The registry is created per semantic
 * session, so a dormant process never allocates one.
 */

import type { RenderableLike, SemanticMeta } from './types.js';

/** Weak, per-session store of {@link describeRenderable} annotations. */
export class SemanticRegistry {
  readonly #entries = new WeakMap<object, SemanticMeta>();

  /**
   * Record (or replace) the annotation for a renderable.
   *
   * @returns a disposer that removes the annotation again.
   */
  register(node: RenderableLike, meta: SemanticMeta): () => void {
    this.#entries.set(node, meta);
    return () => {
      if (this.#entries.get(node) === meta) this.#entries.delete(node);
    };
  }

  /** Look up the annotation for a renderable, if any. */
  get(node: RenderableLike): SemanticMeta | undefined {
    return this.#entries.get(node);
  }
}
