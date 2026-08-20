# @termwright/ink-testing

Component and fixture testing for Ink through the same injected
`@termwright/probe-ink` observation path used by an ordinary application.
Applications keep normal `ink.render`; `@termwright/ink` is optional and only
adds developer annotations.

```tsx
const harness = await mountInk(<Approve onApprove={spy} />);
await harness.press('Tab');
await harness.waitForStable();
await harness.press('Enter');
await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
await harness.close();
```

Input is always terminal input. Nothing invokes component callbacks directly.
Ink does not expose host focus or reliable occlusion, so tests should use
painted output and physical keyboard input instead of asserting an invented
focus flag or clicking through unknown geometry.

## Two modes

| | `mountInk` | `launchInkFixture` |
|---|---|---|
| process | current test process | child process in a real PTY |
| props | any React props, including spies | bounded JSON |
| rerender | React element | JSON props |
| process/env/signal fidelity | modelled | real |

`mountInk` renders with normal Ink and connects the injected probe through an
explicitly internal testing entry point. `launchInkFixture` runs a component
module in a child process and injects the probe with the same preload used by a
production fixture. Neither mode uses a public manual renderer adapter.

Both resolve after the first painted frame and semantic revision. A state
transition followed immediately by another key should use `waitForStable()` so
the application processes the keys in separate commits.

## API

- `mountInk(element, options?)` returns an `InkHarness` with `rerender(element)`
  and `renderError()`.
- `launchInkFixture(options)` returns an `InkFixtureHarness` with
  `rerender(jsonProps)`.
- Both expose the standard `TerminalHarness` locators, screen model, physical
  input, waits, diagnostics, logs, traces, and snapshots.
- Settlement helpers, the in-process PTY backend, streams, and fixture payload
  validation are exported for advanced testing infrastructure.

Both modes accept file-log sources. An in-process mount never mutates
`process.env` or patches the test runner's global console. A fixture gets the
driver's isolated child environment and may be used when process behavior is
part of the test.

See `@termwright/ink` for the annotation-only API and
`@termwright/probe-ink` for observable facts and limitations.
