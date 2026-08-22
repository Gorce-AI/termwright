/**
 * `termwright/test` — the Native Host authoring API, re-exported.
 *
 * Importing this registers termwright's matchers with `expect`, so a test file
 * needs exactly one import for `test`, `expect`, the `terminal` fixture, the
 * matchers and the snapshot helpers.
 *
 * @example
 * ```ts
 * import { expect, test } from 'termwright/test';
 *
 * test('asks before running a command', async ({ terminal }) => {
 *   const app = await terminal.launch({ command: ['node', 'agent.js'] });
 *   await app.waitForText('Permission required');
 *   await app.getByRole('button', { name: 'Approve' }).activate();
 *   await expect(app.getByTestId('status')).toHaveText('approved');
 * });
 * ```
 *
 * @packageDocumentation
 */

export * from '@termwright/test';
