/**
 * `@termwright/test` — the authoring surface for the Termwright Native Host:
 * Vitest-powered DSL, fixtures, retry-able matchers, semantic YAML snapshots
 * and cell snapshots. It is not a direct-Vitest compatibility preset.
 *
 * Importing this module registers the matchers with `expect`, so a test file
 * only ever imports `test` and `expect` from here.
 *
 * @example
 * ```ts
 * import {fileURLToPath} from 'node:url';
 * import {test, expect} from 'termwright/test';
 *
 * test('asks before running a command', async ({ terminal }) => {
 *   const appFile = fileURLToPath(new URL('../app.js', import.meta.url));
 *   const app = await terminal.launch({ command: [process.execPath, appFile] });
 *   await app.waitForText('Permission required');
 *
 *   await expect(app).toMatchSemanticSnapshot(`
 *     - dialog "Permission" [modal]:
 *         - button "Approve" [focused]
 *         - button /^Rej/
 *   `);
 *
 *   await app.getByRole('button', { name: 'Approve' }).activate();
 *   await expect(app.getByTestId('status')).toHaveText('ACTIVATED approve');
 * });
 * ```
 *
 * @packageDocumentation
 */

import { registerTermwrightMatchers } from './matchers.js';

registerTermwrightMatchers();

// Vitest's own API, re-exported so a test file has a single import.
export { afterAll, afterEach, beforeAll, beforeEach, describe, expect, vi } from 'vitest';

// Public harness types belong beside the fixture that returns them. Consumers
// of the umbrella `termwright` package should not need a second direct package
// dependency only to type a custom fixture.
export type { AnyLocator, SemanticLocator, ScreenLocator, TerminalHarness } from '@termwright/driver';

export {
  configureTermwright,
  defineTermwrightConfig,
  getTermwrightConfig,
  termwrightRetry,
  termwrightProjects,
  ANSI_COLOR_NAMES,
  XTERM_PALETTE,
  type ColorPalette,
  type ResolvedTermwrightConfig,
  type TermwrightConfig,
  type TestTimeoutClasses,
  type TraceMode,
  type TermwrightRetryOptions,
  type TermwrightVitestProject,
  type UpdateSnapshotsMode,
} from './config.js';

export {
  it,
  step,
  test,
  type AttachFixtureOptions,
  type LaunchFixtureOptions,
  type OpenShellFixtureOptions,
  type StepOptions,
  type StepRunner,
  type TerminalFactory,
  type TermwrightFixtures,
  type TermwrightScopeFixture,
  type TermwrightTestAPI,
} from './fixtures.js';

export type { ResourceAwareTestApi, TermwrightTestResources } from './provider.js';

export {
  registerTermwrightMatchers,
  type CellSnapshotMatcherOptions,
  type PollOptions,
  type SemanticSnapshotMatcherOptions,
  type TermwrightMatchers,
  type TextMatcherOptions,
} from './matchers.js';

export {
  serializeSemanticSnapshot,
  type SerializeOptions,
  type StateSelection,
} from './yaml-serialize.js';

export { serializeScreen, type CellSnapshotOptions } from './cells.js';

export { ptyAvailable } from './pty-available.js';

export {
  type LaunchOverrides,
  type TermwrightOptions,
} from './options.js';

export {
  seedDirectory,
  type SeedFile,
  type SeedFiles,
  type SeedOptions,
  type SeedTemplate,
} from './seed.js';

export {
  collectLogs,
  type CapturedLog,
  type LogCollection,
  type LogQuery,
  type LogSource,
} from './logs.js';
