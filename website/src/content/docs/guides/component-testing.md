---
title: Component testing
description: mountInk and launchInkFixture through the same injected probe path.
---

`@termwright/ink-testing` runs an Ink component behind the standard terminal
harness. It uses normal `ink.render` and the same `@termwright/probe-ink`
observation path as a launched application.

```tsx
const harness = await mountInk(<Approve onApprove={spy} />);
await harness.press('Tab');
await harness.waitForStable();
await harness.press('Enter');
await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
await harness.close();
```

Input is terminal bytes. No helper invokes component callbacks directly.

```sh
npm install --save-dev @termwright/ink-testing
```

Peer dependencies are Ink >= 7.1 and React >= 19.2. A vanilla component is
observable without an application import. Add optional `useSemantic` or
`<Semantic>` from [`@termwright/ink`](../../adapters/ink/) where the retained
host tree lacks application intent.

## Choosing a mode

| | `mountInk` | `launchInkFixture` |
|---|---|---|
| where it runs | current test process | child process in a real PTY |
| props | any React props, including spies | bounded JSON |
| rerender | React element | JSON props |
| process/env/signal fidelity | modelled | real |

Use `mountInk` for component behavior and `launchInkFixture` when process
identity, environment, signals, crash reporting, or a real PTY is part of the
contract. Both return `TerminalHarness`, so locators, screen assertions, input,
waits, traces, and snapshots are the same.

Both modes settle the first painted frame and semantic revision before they
resolve. When one key changes application state needed by the next key, keep
the commits separate:

```ts
await harness.press('Tab');
await harness.waitForStable();
await harness.press('Enter');
```

Ink does not expose clipping or exact pointer ownership. Tests should verify
painted output for those behaviors and use physical keyboard input. Semantic
pointer actions are unsupported even when intended geometry is available.

## Fixtures and isolation

A fixture module default-exports the component. Props cross a private control
socket as bounded JSON, never through stdin:

```ts
const harness = await launchInkFixture({
  component: new URL('./approve-fixture.mjs', import.meta.url),
  props: {label: 'Approve'},
  nodeArgs: ['--import', 'tsx'],
  columns: 40,
  rows: 10,
});

await harness.rerender({label: 'Reject'});
```

The child environment defaults to the driver's secret-safe replace mode. An
in-process mount never mutates the runner's `process.env`, global console,
stdin, or stdout. Use file log sources in both modes; use a fixture when console
or process environment is what the test needs to observe.

A static fixture must keep its event loop alive long enough for the probe
handshake. Interactive components already do this through `useInput`.

## API

- `mountInk(element, options?)` returns `InkHarness`, adding
  `rerender(element)` and `renderError()` to `TerminalHarness`.
- `launchInkFixture(options)` returns `InkFixtureHarness`, adding
  `rerender(jsonProps)`.
- Settlement primitives, the in-process PTY backend, stream helpers, and
  fixture-payload validation are available for advanced testing infrastructure.
