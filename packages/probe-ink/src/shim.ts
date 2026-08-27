/** Replacement source for Ink's public entry module. */

/** Marker on the shim's re-import of the untouched module. */
export const ORIGINAL_MARKER = 'termwright-original=1';

/**
 * Ink's ESM entry under ordinary node_modules and Bun's versioned cache.
 * Matching the resolved path, rather than the bare specifier, is required by
 * both loader APIs used here.
 */
export const INK_ENTRY_PATTERN = /[\\/](?:ink|ink@[^\\/]+)[\\/]build[\\/]index\.js$/u;

/** The separately-built runtime imported by replacement module source. */
export const INSTRUMENT_URL = new URL('./instrument.js', import.meta.url).href;

export function shouldShim(urlOrPath: string): boolean {
  if (urlOrPath.includes(ORIGINAL_MARKER)) return false;
  return INK_ENTRY_PATTERN.test(urlOrPath.split('?')[0] ?? '');
}

export function originalUrl(urlOrPath: string): string {
  return `${urlOrPath}${urlOrPath.includes('?') ? '&' : '?'}${ORIGINAL_MARKER}`;
}

/** Ink's renderer instance, resolved beside the intercepted public entry. */
export function reconcilerUrl(urlOrPath: string): string {
  const [path] = urlOrPath.split('?');
  if (path === undefined || !INK_ENTRY_PATTERN.test(path)) {
    throw new Error(`Cannot resolve Ink reconciler beside ${urlOrPath}`);
  }
  return path.replace(/index\.js$/u, 'reconciler.js');
}

/**
 * Forward the complete Ink namespace and shadow only `render`.
 *
 * The wrapper receives the already-marked original namespace, so the runtime
 * never imports `ink` itself and cannot recurse through the loader hook.
 */
export function buildShimSource(target: string, instrumentUrl = INSTRUMENT_URL): string {
  const original = JSON.stringify(originalUrl(target));
  const reconciler = JSON.stringify(reconcilerUrl(target));
  const instrument = JSON.stringify(instrumentUrl);
  return `import * as __termwright_original from ${original};
import __termwright_reconciler from ${reconciler};
import {wrapInkRender as __termwright_wrap} from ${instrument};
export * from ${original};

export const render = __termwright_wrap(__termwright_original, {reconciler: __termwright_reconciler});
`;
}
