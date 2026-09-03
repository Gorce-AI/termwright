---
title: Test Ink components
description: Test one Ink component in process or in an isolated terminal fixture.
---

Use `mountInk()` for normal Ink component tests. Use `launchInkFixture()` when
the component's process, environment, signals, crash behavior, or real PTY is
part of the test.

```sh
npm install --save-dev termwright
```

```tsx
import { mountInk } from 'termwright/ink';
import { expect, test, vi } from 'termwright/test';
import { Approve } from './Approve.js';

test('approves the request', async ({ terminal }) => {
  const onApprove = vi.fn();
  const harness = await terminal.attach(await mountInk(<Approve onApprove={onApprove} />), {
    command: ['<mountInk>'],
  });

  await harness.press('Tab');
  await harness.press('Enter');
  await vi.waitFor(() => expect(onApprove).toHaveBeenCalledOnce());
});
```

Input is terminal bytes. No helper invokes component callbacks directly.
`terminal.attach()` adds the component session to traces, Runner live state,
logs, and test teardown. Call `mountInk()` directly only when a standalone
Vitest test deliberately owns and closes the harness itself.

Peer dependencies are Ink 7.1.1 and React >= 19.2. A vanilla component is
observable without an application import. Add optional `useSemantic` or
`<Semantic>` from [`@termwright/ink`](../../adapters/ink/) where the retained
host tree lacks application intent.

## Choosing a mode

|                             | `mountInk`                       | `launchInkFixture`          |
| --------------------------- | -------------------------------- | --------------------------- |
| where it runs               | current test process             | child process in a real PTY |
| props                       | any React props, including spies | bounded JSON                |
| rerender                    | React element                    | JSON props                  |
| process/env/signal fidelity | modelled                         | real                        |

Use `mountInk` for component behavior and `launchInkFixture` when process
identity, environment, signals, crash reporting, or a real PTY is part of the
contract. Both return `TerminalHarness`, so locators, screen assertions, input,
waits, traces, and snapshots are the same.

Both modes wait for the first rendered state before they resolve. When one key
changes application state needed by the next key, send them separately:

```ts
await harness.press('Tab');
await harness.press('Enter');
```

Ink exposes component layout and the part visible in the viewport. Locator
clicks additionally require the component to register its real pointer router;
without one, use keyboard input. Termwright still sends pointer input through
the component harness instead of calling a callback directly.

`@termwright/ink` is the focused package behind `termwright/ink`.
Install it directly when a component-only project deliberately wants the
focused harness without the Termwright CLI and Runner dependencies.

## Fixtures and isolation

A fixture module default-exports the component. Props are JSON values sent over
the fixture control channel, not through stdin:

```ts
const harness = await launchInkFixture({
  component: new URL('./approve-fixture.mjs', import.meta.url),
  props: { label: 'Approve' },
  nodeArgs: ['--import', 'tsx'],
  columns: 40,
  rows: 10,
});

await harness.rerender({ label: 'Reject' });
```

The child receives Termwright's isolated test environment. An in-process mount
does not change the test process's `process.env`, global console, stdin, or
stdout. Use a child fixture when console or process environment is what the
test needs to observe.

A static fixture must keep its event loop alive long enough for the probe
handshake. Interactive components already do this through `useInput`.

## API

- `mountInk(element, options?)` returns `InkHarness`, adding
  `rerender(element)` and `renderError()` to `TerminalHarness`.
- `launchInkFixture(options)` returns `InkFixtureHarness`, adding
  `rerender(jsonProps)`.
- Settlement primitives, the in-process PTY backend, stream helpers, and
  fixture-payload validation are available for advanced testing infrastructure.
