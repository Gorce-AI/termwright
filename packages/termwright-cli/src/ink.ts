/**
 * `termwright/ink` — component testing for Ink, re-exported.
 *
 * `mountInk` runs a component in this process over a headless terminal;
 * `launchInkFixture` runs it in a real pseudo-terminal. Both hand back the same
 * `TerminalHarness` an end-to-end test drives.
 *
 * @example
 * ```ts
 * import { mountInk } from 'termwright/ink';
 *
 * const harness = await mountInk(<Approve onApprove={spy} />, { columns: 40, rows: 8 });
 * await harness.press('Tab');
 * await harness.waitForStable();
 * await harness.press('Enter');
 * await harness.close();
 * ```
 *
 * @packageDocumentation
 */

export * from '@termwright/ink';
