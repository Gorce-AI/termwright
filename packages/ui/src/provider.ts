/**
 * Declaration-time marker shared by test providers and the UI host.
 *
 * A fixture is too late for discovery: it starts only when Vitest executes a
 * case. Providers therefore attach this small, serialisable marker to
 * `task.meta` while the case is declared. The UI treats an absent or malformed
 * marker as foreign and fails closed.
 */

export const TERMWRIGHT_PROVIDER_VERSION = 1 as const;

export interface TermwrightProviderMarker {
  /** Package or adapter which declared the case. */
  readonly id: string;
  /** Version of this marker envelope, independent of the provider version. */
  readonly version: typeof TERMWRIGHT_PROVIDER_VERSION;
}

export type TermwrightProviderDeclaredMode = 'run' | 'skip' | 'todo';

/** Provider-owned execution intent captured before Vitest applies global `.only`. */
export interface TermwrightProviderDeclaration {
  readonly mode: TermwrightProviderDeclaredMode;
  readonly exclusive: boolean;
}

/** The structural metadata boundary used by discovery, reporters and runners. */
export interface TermwrightProviderTaskMeta {
  readonly termwright?: {
    readonly provider?: unknown;
    readonly declaration?: unknown;
  };
}

/** Creates the serialisable marker a Termwright test provider owns. */
export function termwrightProvider(id: string): TermwrightProviderMarker {
  if (id === '') throw new TypeError('a Termwright provider id cannot be empty');
  return { id, version: TERMWRIGHT_PROVIDER_VERSION };
}

/** True only for the explicit, versioned marker — never for incidental metadata. */
export function hasTermwrightProvider(meta: unknown): meta is TermwrightProviderTaskMeta {
  if (typeof meta !== 'object' || meta === null) return false;
  const termwright = (meta as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null) return false;
  const provider = (termwright as Record<string, unknown>)['provider'];
  if (typeof provider !== 'object' || provider === null) return false;
  const record = provider as Record<string, unknown>;
  return record['version'] === TERMWRIGHT_PROVIDER_VERSION &&
    typeof record['id'] === 'string' && record['id'] !== '';
}

/** Reads a declaration only when both fields are valid and bounded. */
export function termwrightProviderDeclaration(meta: unknown): TermwrightProviderDeclaration | undefined {
  if (!hasTermwrightProvider(meta)) return undefined;
  const declaration = meta.termwright?.declaration;
  if (typeof declaration !== 'object' || declaration === null) return undefined;
  const record = declaration as Record<string, unknown>;
  const mode = record['mode'];
  if (mode !== 'run' && mode !== 'skip' && mode !== 'todo') return undefined;
  if (typeof record['exclusive'] !== 'boolean') return undefined;
  return { mode, exclusive: record['exclusive'] };
}
