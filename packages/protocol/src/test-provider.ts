/** Versioned declaration metadata shared by test providers and the native host. */

export const TERMWRIGHT_PROVIDER_VERSION = 1 as const;

export interface TermwrightProviderMarker {
  readonly id: string;
  readonly version: typeof TERMWRIGHT_PROVIDER_VERSION;
}

export type TermwrightProviderDeclaredMode = 'run' | 'skip' | 'todo';

export interface TermwrightProviderDeclaration {
  readonly mode: TermwrightProviderDeclaredMode;
  readonly exclusive: boolean;
}

export interface TermwrightProviderTaskMeta {
  readonly termwright?: {
    readonly provider?: unknown;
    readonly declaration?: unknown;
  };
}

export function termwrightProvider(id: string): TermwrightProviderMarker {
  if (id === '') throw new TypeError('a Termwright provider id cannot be empty');
  return { id, version: TERMWRIGHT_PROVIDER_VERSION };
}

export function hasTermwrightProvider(meta: unknown): meta is TermwrightProviderTaskMeta {
  if (typeof meta !== 'object' || meta === null) return false;
  const termwright = (meta as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null) return false;
  const provider = (termwright as Record<string, unknown>)['provider'];
  if (typeof provider !== 'object' || provider === null) return false;
  const record = provider as Record<string, unknown>;
  return (
    record['version'] === TERMWRIGHT_PROVIDER_VERSION &&
    typeof record['id'] === 'string' &&
    record['id'] !== ''
  );
}

export function termwrightProviderDeclaration(
  meta: unknown,
): TermwrightProviderDeclaration | undefined {
  if (!hasTermwrightProvider(meta)) return undefined;
  const declaration = meta.termwright?.declaration;
  if (typeof declaration !== 'object' || declaration === null) return undefined;
  const record = declaration as Record<string, unknown>;
  const mode = record['mode'];
  if (mode !== 'run' && mode !== 'skip' && mode !== 'todo') return undefined;
  if (typeof record['exclusive'] !== 'boolean') return undefined;
  return { mode, exclusive: record['exclusive'] };
}
