import {
  REACT_DEVTOOLS_HOOK,
  type ReactCommitBridge,
} from './react-commit-bridge.js';

export const INK_REACT_INSTRUMENTATION_UNAVAILABLE =
  'Ink semantic probe unavailable: React renderer instrumentation did not expose expected committed Ink root.';

interface ReconcilerModule {
  readonly default?: {
    injectIntoDevTools?: () => boolean;
  };
}

export interface InkReactActivation {
  readonly reconcilerUrl: string;
  readonly injected: true;
  readonly rendererIds: readonly number[];
}

export type InkModuleImporter = (url: string) => Promise<unknown>;

/**
 * Activates the instrumentation method already provided by Ink's reconciler.
 *
 * The private sibling URL is derived from the loader-resolved public Ink entry;
 * no package-root discovery, build-artifact scan, source read, or transform is
 * involved. Candidates without this runtime capability are rejected rather
 * than observed through a lower-fidelity fallback.
 */
export async function activateInkReactInstrumentation(
  publicInkEntryUrl: string,
  bridge: ReactCommitBridge,
  importer: InkModuleImporter = (url) => import(url),
): Promise<InkReactActivation> {
  assertCompatibleHook(bridge);
  const reconcilerUrl = reconcilerUrlFromPublicEntry(publicInkEntryUrl);
  let loaded: unknown;
  try {
    loaded = await importer(reconcilerUrl);
  } catch (error) {
    throw unavailable(`could not load reconciler sibling ${reconcilerUrl}`, error);
  }
  const reconciler = (loaded as ReconcilerModule | null)?.default;
  if (reconciler === null || typeof reconciler !== 'object'
    || typeof reconciler.injectIntoDevTools !== 'function') {
    throw unavailable('Ink reconciler does not expose injectIntoDevTools()');
  }
  const before = new Set(bridge.inkRenderers.keys());
  try {
    // React reconciler's boolean return is not an acceptance contract: current
    // Ink/React returns false even after synchronously injecting and later
    // delivering commits. The bridge registry is the behavioral evidence.
    reconciler.injectIntoDevTools.call(reconciler);
  } catch (error) {
    throw unavailable('Ink reconciler rejected instrumentation activation', error);
  }
  const rendererIds = [...bridge.inkRenderers.keys()].filter((id) => !before.has(id));
  if (rendererIds.length === 0) {
    throw unavailable('Ink reconciler did not register a renderer with the installed bridge');
  }
  return { reconcilerUrl, injected: true, rendererIds: Object.freeze(rendererIds) };
}

export function reconcilerUrlFromPublicEntry(publicInkEntryUrl: string): string {
  let entry: URL;
  try {
    entry = new URL(publicInkEntryUrl);
  } catch (error) {
    throw unavailable('public Ink entry is not an absolute URL', error);
  }
  if (entry.protocol !== 'file:') {
    throw unavailable(`unsupported public Ink entry protocol ${entry.protocol}`);
  }
  return new URL('./reconciler.js', entry).href;
}

function assertCompatibleHook(bridge: ReactCommitBridge): void {
  const hook = (globalThis as typeof globalThis & Record<string, unknown>)[REACT_DEVTOOLS_HOOK];
  if (hook === null || typeof hook !== 'object'
    || (hook as { supportsFiber?: unknown }).supportsFiber !== true
    || typeof (hook as { inject?: unknown }).inject !== 'function') {
    throw unavailable('compatible React renderer hook is not installed');
  }
  if (hook !== bridge.hook) {
    throw unavailable('installed React renderer hook is not owned by the supplied bridge');
  }
}

function unavailable(detail: string, cause?: unknown): Error {
  return new Error(`${INK_REACT_INSTRUMENTATION_UNAVAILABLE} ${detail}`, { cause });
}
