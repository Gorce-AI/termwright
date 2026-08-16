---
title: Component testing
description: mountInk and launchInkFixture — two modes behind one harness, when to pick which, and the traps that cost an afternoon each.
---

`@termwright/ink-testing` runs a component instead of a process, in two modes
behind one interface:

```tsx
const harness = await mountInk(<Approve onApprove={spy} />);
await harness.getByRole('button', {name: 'Approve'}).click();
expect(spy).toHaveBeenCalledOnce();
```

That click is a mouse report on the component's stdin — the same bytes a
terminal sends when a user clicks that cell. Nothing calls into your component
directly, so a passing test is evidence the component works, not evidence its
props were wired to the test.

```sh
npm install --save-dev @termwright/ink-testing
```

Peer dependencies: `ink >= 7.1`, `react >= 19.2`, Node >= 22. Components must be
rendered through [`@termwright/ink`](../../adapters/ink/) and annotated with
`useSemantic` (or Ink's `aria-*` props) to be addressable by role.

## Choosing a mode

| | `mountInk` | `launchInkFixture` |
|---|---|---|
| where the component runs | this process | a child process, in a real pty |
| props | anything, including callbacks and spies | bounded JSON |
| speed | ~100 ms per mount | ~400 ms per launch |
| `rerender` | a React element | props, as bounded JSON |
| `renderError` | yes | no |
| raw mode, signals, `SIGWINCH` | modelled | real |

Reach for `mountInk` by default, and for `launchInkFixture` when the *process*
is part of what you are testing. Both return the driver's `TerminalHarness`, so
locators, actions, waits and matchers are identical and moving a test between
modes changes its first line only.

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

Both mounts and launches resolve once the application has committed and
published its first frame *and* gone quiet, so locators work immediately with no
warm-up wait. `rerender` does the same for the frame it causes.

## Traps worth knowing before you hit them

### A fixture must hold the event loop open

A component that renders once and handles no input references nothing, so Node
drains the loop and Ink unmounts on `beforeExit`. The launch then fails with
`process-exited` before the harness ever sees a frame.

Any component with `useInput` — that is, any interactive one — is fine. A purely
static one needs something to keep it alive.

### `NODE_OPTIONS` does not reach a fixture

The fixture process does not inherit your environment. `envMode` defaults to
`'replace'`, so it starts from an allowlist (`PATH`, `HOME`, `LANG`, `LC_ALL`,
`SHELL`, `TMPDIR`, `USER`, `TERM`) plus whatever you pass in `env`. That
deliberately excludes `NODE_OPTIONS`, which is how TypeScript loaders are
usually configured.

Pass the loader explicitly instead — this is the form that keeps working in CI
regardless of how the runner was started:

```ts
const harness = await launchInkFixture({
  component: new URL('./approve-fixture.mjs', import.meta.url),
  props: {label: 'Approve'},
  nodeArgs: ['--import', 'tsx'],
  columns: 40,
  rows: 10,
});
```

The fixture module default-exports the component; props cross as JSON and are
validated before a process is spawned, so a stray callback fails the test
instead of silently arriving as `undefined`.

### `envMode` isolates the session, not the mount

This is the subtle one. `envMode` shapes the environment the *session* builds.

- In a **fixture** — a separate process — `'replace'` is real: the component's
  `process.env` is exactly what the driver handed it.
- In a **mount**, the component reads the runner's own `process.env` object,
  which a mount deliberately never mutates. No `envMode` can hide a variable
  from it.

Use `launchInkFixture` when the component's environment is part of what you are
testing.

In the other direction a mount is airtight: no `TERMWRIGHT_*` in `process.env`,
no patched `console`, no listener on the runner's `process.stdout`, no raw mode
on its `process.stdin`, and no open socket after `close()`. The instrumentation
environment is handed to the adapter directly rather than exported, which is what
keeps one component test from silently instrumenting every other process the
suite spawns.

### Write the assertion as the wait

`waitForText` is satisfied by the screen; the semantic tree for that frame is
published a moment later. With the preset's matchers this costs you nothing,
because they poll:

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

Reading `semanticState()` or a state flag directly right after a text wait is
the case that needs `await harness.waitForStable()`.

### Clicking needs mouse tracking in your component

A click needs two things: bounds, and a component that can observe a mouse
report. Bounds come free — the adapter publishes them for interactive
alternate-screen renders, which is what both modes use.

Mouse reports do not. Like any terminal program, your app has to enable mouse
tracking (`CSI ? 1000 h` plus `CSI ? 1006 h`) and interpret what it then
receives. If it does not, `click()` refuses with `unsupported-action` rather
than sending bytes nothing will read — drive those components with `press()` and
`activate()` instead.

## Using the preset's matchers without a pty

The harness a mount returns is the driver's own, so `@termwright/test` works on
it unchanged. That is also the only way to reach the matchers where no
pseudo-terminal is available — a sandboxed container, a Windows runner without
ConPTY, or a machine where the native pty binding failed to build.

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

A fixture's props can be changed after launch too:

```ts
await harness.rerender({label: 'Reject'});
```

That travels over a private socket the harness created, not over stdin — stdin
belongs to the simulated user, and multiplexing commands onto it would make
every keystroke test depend on nobody typing the escape sequence the harness
happens to use. The component itself is fixed when the fixture starts: a
rerender changes what it shows, never which code runs.
