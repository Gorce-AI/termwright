# @termwright/ink-testing

Component testing for [Ink](https://github.com/vadimdemedes/ink), in two modes
behind one interface.

```tsx
const harness = await mountInk(<Approve onApprove={spy} />);
await harness.getByRole('button', {name: 'Approve'}).click();
expect(spy).toHaveBeenCalledOnce();
```

That click is a mouse report on the component's stdin — the same bytes a
terminal sends when a user clicks that cell. Nothing here calls into your
component directly, so a test that passes is evidence the component works, not
evidence its props were wired to the test.

## Install

```sh
npm install --save-dev @termwright/ink-testing
```

Peer dependencies: `ink >= 7.1`, `react >= 19.2`, Node >= 22. Your components
must be rendered by [`@termwright/ink`](../ink) — annotate them with
`useSemantic` (or Ink's own `aria-*` props) to make them addressable by role.

## The two modes

| | `mountInk` | `launchInkFixture` |
|---|---|---|
| where the component runs | this process | a child process, in a real pty |
| props | anything, including callbacks and spies | bounded JSON |
| speed | ~100 ms per mount | ~400 ms per launch |
| `rerender`, `renderError` | yes | no |
| raw mode, signals, `SIGWINCH` | modelled | real |

Reach for `mountInk` by default and for `launchInkFixture` when the *process* is
part of what you are testing. Both return the driver's `TerminalHarness`, so
everything else about the test — locators, actions, waits, matchers — is
identical, and moving a test between modes changes its first line only.

## Usage

```tsx
import {mountInk} from '@termwright/ink-testing';
import {expect, test, vi} from 'vitest';
import {Approve} from '../src/approve.js';

test('approves on click', async () => {
  const onApprove = vi.fn();
  const harness = await mountInk(<Approve onApprove={onApprove} />, {
    columns: 40,
    rows: 10,
  });

  await harness.getByRole('button', {name: 'Approve'}).click();
  await harness.waitForText('approved');
  expect(onApprove).toHaveBeenCalledOnce();

  await harness.rerender(<Approve onApprove={onApprove} disabled />);
  await expect(harness.getByRole('button', {name: 'Approve'}).click()).rejects.toThrow();

  await harness.close();
});
```

The same component in a real terminal:

```ts
const harness = await launchInkFixture({
  component: new URL('./approve-fixture.mjs', import.meta.url),
  props: {label: 'Approve'},
  columns: 40,
  rows: 10,
});
```

The fixture module default-exports the component; props cross as JSON and are
validated before a process is spawned, so a stray callback fails the test
instead of silently arriving as `undefined`.

Two things to know when writing one:

- **A fixture must hold the event loop open.** A component that renders once and
  handles no input references nothing, so Node drains the loop and Ink unmounts
  on `beforeExit` — the launch then fails with `process-exited` before the
  harness sees a frame. Any component with `useInput` (that is, any interactive
  one) is fine; a purely static one needs something to keep it alive.
- **The fixture process does not inherit your environment.** `envMode` defaults
  to `'replace'`, so it starts from an allowlist (`PATH`, `HOME`, `LANG`,
  `LC_ALL`, `SHELL`, `TMPDIR`, `USER`, `TERM`) plus whatever you pass in `env`.
  That deliberately excludes `NODE_OPTIONS`: if your TypeScript fixtures rely on
  a loader configured that way, pass it explicitly as `nodeArgs: ['--import',
  'tsx']`, which is the form that keeps working in CI regardless of how the
  runner was started.

## What the harness resolves with

`mountInk` and `launchInkFixture` both resolve once the application has
committed and published its first frame *and* gone quiet, so locators work
immediately without a warm-up wait. `rerender` does the same for the frame it
causes. Every wait in this package is driven by the session's revisions; nothing
sleeps.

One thing worth knowing: `waitForText` is satisfied by the screen, and the
semantic tree describing that frame is published a moment later. When an
assertion reads the tree (`semanticState()`, a value, a state flag) right after
a text wait, follow it with `waitForStable()`.

## Clicking

A click needs two things from your component: bounds, and a way to observe a
mouse report. Bounds come free — the adapter publishes them for interactive
alternate-screen renders, which is what both modes use. Mouse reports do not:
like any terminal program, your app has to enable mouse tracking
(`CSI ? 1000 h` plus `CSI ? 1006 h`) and interpret the reports it then receives. If it
does not, `click()` refuses with `unsupported-action` rather than sending bytes
nothing will read — drive those components with `press()` and `activate()`
instead.

## API

- `mountInk(element, options?)` → `InkHarness`. Options: `columns`, `rows`,
  `wrapper`, `env`, `timeouts`, `settleTimeout`, `ink` (a curated subset of
  Ink's render options).
- `InkHarness` — the driver's `TerminalHarness`, plus `rerender(element)` and
  `renderError()`.
- `launchInkFixture(options)` → `TerminalHarness`. Options: `component`,
  `exportName`, `props`, `columns`, `rows`, `cwd`, `env`, `nodeArgs`,
  `timeouts`, `settleTimeout`.
- `commitFrame(harness, mutate)` / `waitForFirstFrame(harness)` — the settlement
  primitives, for harnesses you build yourself.
- `createInProcessBackend(start)`, `createHarnessStdout`, `createHarnessStdin`,
  `applyOnlcr` — the pty stand-in, exported for adapters other than Ink.
- `encodeFixturePayload`, `assertJsonProps` — the fixture boundary.

## With the Vitest preset

The harness a mount returns is the driver's own, so
[`@termwright/test`](../test) works on it unchanged — including the matchers
that poll, which is what lets an assertion follow physical input with no wait in
between:

```ts
import {expect, test} from '@termwright/test';

test('moves focus on Tab', async () => {
  const harness = await mountInk(<Form />, {columns: 44, rows: 10});
  await harness.press('Tab');

  await expect(harness.getByRole('textbox', {name: 'Message'})).toBeFocused();
  await expect(harness).toMatchSemanticSnapshot();

  await harness.close();
});
```

This is also the only way to reach those matchers where no pseudo-terminal is
available — a sandboxed container, or a machine where the native pty binding
failed to build.

## Isolation

A mount leaves nothing behind in the process that hosts it: no
`TERMWRIGHT_*` in `process.env`, no patched `console`, no listener on the
runner's `process.stdout`, no raw mode on the runner's `process.stdin`, and no
open socket after `close()`. The instrumentation environment is handed to the
adapter directly instead of being exported, which is what keeps a component test
from silently instrumenting every other process the suite spawns.

Isolation in the other direction is where the modes differ, and it is worth
being precise about. `envMode` shapes the environment the *session* builds, so
in a fixture — a separate process — `'replace'` is real: the component's
`process.env` is exactly what the driver handed it. In a mount the component
calls `process.env` on the runner's own object, which a mount deliberately never
mutates, so no `envMode` can hide a variable from it. Use `launchInkFixture`
when the component's environment is part of what you are testing.
