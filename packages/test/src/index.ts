/**
 * `@termwright/test` — the Vitest preset: fixtures, retry-able matchers,
 * semantic YAML snapshots and cell snapshots.
 *
 * Importing this module registers the matchers with `expect`, so a test file
 * only ever imports `test` and `expect` from here.
 *
 * @example
 * ```ts
 * import { test, expect } from '@termwright/test';
 *
 * test('asks before running a command', async ({ terminal }) => {
 *   const app = await terminal.launch({ command: ['node', 'app.js'] });
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

export {
  configureTermwright,
  defineTermwrightConfig,
  getTermwrightConfig,
  resetTermwrightConfig,
  resolveTermwrightConfig,
  ANSI_COLOR_NAMES,
  XTERM_PALETTE,
  type ColorPalette,
  type ResolvedTermwrightConfig,
  type TermwrightConfig,
  type TestTimeoutClasses,
  type TraceMode,
  type UpdateSnapshotsMode,
} from './config.js';

export {
  it,
  step,
  test,
  type LaunchFixtureOptions,
  type StepRunner,
  type TerminalFactory,
  type TermwrightFixtures,
  type TermwrightScopeFixture,
  type TermwrightTestAPI,
} from './fixtures.js';

export {
  registerTermwrightMatchers,
  termwrightMatchers,
  type CellSnapshotMatcherOptions,
  type PollOptions,
  type SemanticSnapshotMatcherOptions,
  type TermwrightMatchers,
  type TextMatcherOptions,
} from './matchers.js';

export {
  serializeSemanticSnapshot,
  childIndex,
  describeNode,
  describeState,
  normalizeName,
  topLevel,
  ALL_STATE_KEYS,
  STABLE_STATE_KEYS,
  type SerializeOptions,
  type StateSelection,
} from './yaml-serialize.js';

export {
  parseNodeHead,
  parseSemanticSnapshot,
  type FlagAssertion,
  type NameMatcher,
  type NodePattern,
} from './yaml-pattern.js';

export {
  matchSemanticSnapshot,
  type MatchOptions,
  type SnapshotMatchResult,
  type SnapshotMismatch,
} from './yaml-match.js';

export { serializeScreen, type CellSnapshotOptions } from './cells.js';

export { ptyAvailable, resetPtyProbe } from './pty-available.js';

export { collectTestNames, type DeclaredTask } from './declared-tests.js';

export {
  beginSnapshotScope,
  nextSnapshotKey,
  pruneObsoleteSnapshots,
  type ObsoleteSnapshots,
  readSnapshot,
  resetSnapshotCache,
  resolveUpdateMode,
  snapshotFilePath,
  writeSnapshot,
  type SnapshotKind,
} from './snapshot-store.js';

export {
  currentScope,
  enterScope,
  openStep,
  recordAssert,
  scopeKey,
  type AssertRecord,
  type TermwrightScope,
} from './trace-context.js';

export type { TermwrightTaskMeta } from './task-meta.js';

// The reporter is deliberately NOT re-exported here: `vitest.config.ts` runs
// before the test runner exists, and this module registers matchers on import.
// Import it from `@termwright/test/reporter` instead.
