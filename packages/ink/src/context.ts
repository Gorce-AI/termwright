/**
 * The React context carrying the active session's registry.
 *
 * `null` means "no semantic session" — the dormant case, and also the case of
 * a component tree mounted with plain `ink.render`. {@link useSemantic} degrades
 * to a no-op then, so annotating components never depends on how they are
 * mounted.
 */

import { createContext } from 'react';
import type { SemanticRegistry } from './registry.js';

/** @internal */
export const RegistryContext = createContext<SemanticRegistry | null>(null);
