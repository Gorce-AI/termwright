/**
 * `termwright/gherkin` — physical Gherkin features and the public Vitest plugin.
 *
 * `termwright ui` installs the plugin automatically. Import this authoring
 * surface from paired glue; an ordinary Vitest/IDE run still opts in by adding
 * `gherkinPlugin()` and a `.feature` include to its own config.
 *
 * @packageDocumentation
 */

import {
  gherkinPlugin as packageGherkinPlugin,
  type GherkinPluginOptions,
} from '@termwright/gherkin';

export * from '@termwright/gherkin';

/**
 * Creates the plugin with generated imports that stay on the umbrella package.
 * Strict package managers therefore need only the documented `termwright`
 * dependency at the project root.
 */
export function gherkinPlugin<Fixtures extends object = Record<string, unknown>>(
  options: GherkinPluginOptions<Fixtures> = {},
) {
  return packageGherkinPlugin<Fixtures>({
    ...options,
    generatedImports: {
      test: options.generatedImports?.test ?? 'termwright/test',
      runtime: options.generatedImports?.runtime ?? 'termwright/gherkin/runtime',
    },
  });
}
