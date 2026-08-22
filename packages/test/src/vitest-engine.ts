/** Exact dependency boundary for Vitest as Termwright's embedded test engine. */

import { createRequire } from 'node:module';

export const CERTIFIED_VITEST_VERSION = '3.2.7' as const;
export const TERMWRIGHT_RUNNER_CONTEXT_KEY = 'termwright.runner.context.v3' as const;

/** Reads the package which supplies the embedded Vitest engine. */
export function installedVitestVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require('vitest/package.json') as { readonly version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('the installed Vitest package has no valid version');
  }
  return manifest.version;
}

export function assertCertifiedVitestRuntime(version = installedVitestVersion()): void {
  if (version !== CERTIFIED_VITEST_VERSION) {
    throw new Error(
      `unsupported Vitest runtime ${version}; Termwright is exact-certified for ${CERTIFIED_VITEST_VERSION}`,
    );
  }
}
