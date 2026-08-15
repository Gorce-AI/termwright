/**
 * `termwright` — the one package to install.
 *
 * This entry point is the **runtime** surface: launching and driving a terminal
 * session, and the error taxonomy that comes back when something goes wrong. It
 * is a re-export of `@termwright/driver`, so a script, a `node:test` file or a
 * one-off automation needs no other dependency.
 *
 * The test-time surfaces live behind subpaths, deliberately:
 *
 * | Import | What you get |
 * |---|---|
 * | `termwright` | `launchTerminal`, locators, actions, waits, errors |
 * | `termwright/test` | the Vitest preset: `test`, `expect`, matchers, snapshots |
 * | `termwright/ink` | `mountInk`, `launchInkFixture` for Ink components |
 *
 * `termwright/test` imports Vitest and registers matchers on import, which is
 * exactly what a test file wants and exactly what a production script does not.
 * Keeping them apart is what lets the same package be a dependency of both.
 *
 * @example
 * ```ts
 * import { launchTerminal } from 'termwright';
 *
 * const app = await launchTerminal({ command: ['node', 'agent.js'] });
 * await app.waitForText('Permission required');
 * await app.getByRole('button', { name: 'Approve' }).activate();
 * await app.close();
 * ```
 *
 * @packageDocumentation
 */

export * from '@termwright/driver';

export { CLI_NAME, CLI_VERSION } from './version.js';
