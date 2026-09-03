/** One Vite override shared by UI discovery, the watcher, and every browser rerun. */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gherkinPlugin } from '@termwright/gherkin';
import type { Vite } from 'vitest/node';

const require = createRequire(import.meta.url);

function gherkinEntry(file: 'index.js' | 'runtime.js'): string {
  const manifest = require.resolve('@termwright/gherkin/package.json');
  return join(dirname(manifest), 'dist', file);
}

function embeddedVitestEntry(): string {
  const testEntry = fileURLToPath(import.meta.resolve('@termwright/test'));
  return resolve(dirname(testEntry), '..', 'vendor', 'vitest', 'dist', 'index.js');
}

/**
 * Installs the managed Gherkin transform without changing ordinary Vitest.
 * Exact aliases keep generated/runtime and authoring imports on the plugin
 * version owned by this host, including under strict non-hoisting installers.
 */
export function uiVitestViteOverrides(): Vite.UserConfig {
  return {
    plugins: [
      gherkinPlugin({
        includeFeatures: true,
        ...(process.env['TERMWRIGHT_GHERKIN_TAGS'] === undefined
          ? {}
          : { tags: process.env['TERMWRIGHT_GHERKIN_TAGS'] }),
      }),
    ],
    resolve: {
      alias: [
        // Test modules execute inside the same physical Vitest instance as the
        // host. This is essential for process-global facilities such as fake
        // timers and keeps a consumer's separately installed Vitest isolated.
        {
          find: /^vitest$/,
          replacement: embeddedVitestEntry(),
        },
        {
          find: '@termwright/gherkin/runtime',
          replacement: gherkinEntry('runtime.js'),
        },
        {
          find: /^@termwright\/gherkin$/,
          replacement: gherkinEntry('index.js'),
        },
      ],
    },
  };
}
