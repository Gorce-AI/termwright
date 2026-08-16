/**
 * The module shim: how `createCliRenderer` gets wrapped without the
 * application importing anything of ours.
 *
 * Both runtimes give us the same primitive — a hook that can replace a
 * module's source — and neither gives us a way to *edit* an ES module's
 * exports, because those bindings are immutable by design. So the shim is a
 * replacement module that re-imports the real one under a marked URL,
 * re-exports everything it had, and shadows the single function we care about.
 *
 * Two properties make this safe rather than clever:
 *
 * - `export *` forwards every other binding untouched, so a version of OpenTUI
 *   that grows an export keeps working without us knowing about it. An explicit
 *   local export shadows a star-export, which is what lets one name be replaced
 *   while the rest passes through.
 * - The marked URL is what stops the hook recursing into its own output. The
 *   marker has to be checked *before* the path pattern, because the pattern
 *   sees a path that still ends in the entry filename.
 *
 * Verified in both runtimes against `@opentui/core@0.5.3`: the application's
 * `createCliRenderer` is ours and `Renderable`, `TextRenderable` and the rest
 * arrive intact.
 */

import { pathToFileURL } from 'node:url';

/** Query marker appended to the real module's URL. */
export const ORIGINAL_MARKER = 'termwright-original=1';

/**
 * Entry files of `@opentui/core`. Bun and Node resolve to different builds of
 * the same package (`index.bun.js` / `index.node.js`), and both must be
 * covered: the launcher does not get to choose which one the application
 * imports.
 */
export const OPENTUI_ENTRY_PATTERN = /@opentui[\\/]core[\\/]index\.(bun|node)\.js$/u;

/**
 * Whether a module path or URL is the OpenTUI entry that should be shimmed.
 *
 * Returns `false` for anything already carrying {@link ORIGINAL_MARKER}, which
 * is the re-import the shim itself performs.
 */
export function shouldShim(urlOrPath: string): boolean {
  if (urlOrPath.includes(ORIGINAL_MARKER)) return false;
  const withoutQuery = urlOrPath.split('?')[0] ?? '';
  return OPENTUI_ENTRY_PATTERN.test(withoutQuery);
}

/**
 * Turn a filesystem path into a `file://` URL, leaving a URL untouched.
 *
 * Used for the **launcher flag**, not inside the shim. On Windows an absolute
 * path handed to `node --import` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`
 * because `D:` reads as a scheme, which is a confusing way for a drive letter
 * to fail.
 *
 * It is deliberately NOT applied to the shim's own import specifier: measured
 * under Bun 1.2.15, a shim that re-imports through a `file://` URL re-exports
 * **nothing** — the module arrives with one export instead of the framework's
 * whole surface. Each loader gets back the form it handed us, because that is
 * the form it demonstrably consumes.
 */
export function toModuleUrl(urlOrPath: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(urlOrPath)) return urlOrPath;
  const [pathPart = '', query] = urlOrPath.split('?');
  const url = pathToFileURL(pathPart).href;
  return query === undefined ? url : `${url}?${query}`;
}

/**
 * The URL the shim imports to reach the untouched module.
 *
 * Preserves any query the loader already put there, so a runtime that
 * round-trips its own parameters does not lose them.
 */
export function originalUrl(urlOrPath: string): string {
  const separator = urlOrPath.includes('?') ? '&' : '?';
  return `${urlOrPath}${separator}${ORIGINAL_MARKER}`;
}

/**
 * Build the replacement module source.
 *
 * The wrapper is deliberately thin: it awaits the real renderer and hands it to
 * whatever attached itself to the process, then returns it unchanged. Any fault
 * in our side is swallowed — an instrumented application must still run exactly
 * as it would have.
 *
 * @param target - URL or path of the real entry, without the marker.
 */
export function buildShimSource(target: string): string {
  const original = JSON.stringify(originalUrl(target));
  return `import * as __termwright_original from ${original};
export * from ${original};

const __termwright_wrapped = async function createCliRenderer(config) {
  const renderer = await __termwright_original.createCliRenderer(config);
  try {
    globalThis.__termwright_onRenderer?.(renderer);
  } catch {
    // The probe is never allowed to break the application it observes.
  }
  return renderer;
};
__termwright_wrapped.__termwright__ = true;

export const createCliRenderer = __termwright_wrapped;
`;
}
