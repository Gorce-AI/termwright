/**
 * `@termwright/ink-testing` — component testing for Ink, in two modes behind
 * one interface.
 *
 * {@link mountInk} runs the component in this process; {@link launchInkFixture}
 * runs it in a real pseudo-terminal. Both return a `TerminalHarness` from
 * `@termwright/driver`, so the locators, actions, waits and matchers a test
 * uses are the same ones an end-to-end test uses — and moving a test between
 * the two modes changes its first line and nothing else.
 *
 * Neither mode ever calls into the component directly. A click is a mouse
 * report on stdin, a keystroke is key bytes, and the assertion afterwards is on
 * what the component did with them.
 *
 * @example
 * ```tsx
 * import { mountInk } from '@termwright/ink-testing';
 *
 * const harness = await mountInk(<Approve onApprove={spy} />, { columns: 40, rows: 8 });
 * await harness.press('Enter');
 * await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
 * await harness.close();
 * ```
 */

export { mountInk } from './mount.js';
export type { InkHarness, MountInkOptions, MountInkRenderOptions } from './mount.js';

export { launchInkFixture } from './fixture.js';
export type { InkFixtureHarness, LaunchInkFixtureOptions } from './fixture.js';

export { ForwardingHarness } from './forwarding.js';

export { commitFrame, waitForFirstFrame } from './settle.js';
export type { SettleOptions } from './settle.js';

export {
  assertJsonProps,
  encodeFixturePayload,
  MAX_PAYLOAD_BYTES,
  MAX_PROPS_DEPTH,
} from './payload.js';
export type { FixturePayload, JsonProps, JsonValue } from './payload.js';

export { createInProcessBackend } from './backend.js';
export type { InProcessApp, InProcessIo, InProcessStart } from './backend.js';

export { applyOnlcr, createHarnessStdin, createHarnessStdout } from './streams.js';
export type { HarnessStdin, HarnessStdout } from './streams.js';
