# @termwright/ink

Ink annotations and component testing through one public package. Ordinary
applications keep their normal Ink entry point:

```tsx
import { render, Box, Text, type DOMElement } from 'ink';
import { useRef } from 'react';
import { useSemantic } from '@termwright/ink';

function Approve() {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, {
    role: 'button',
    name: 'Approve',
    description: 'Accept the pending change',
    testId: 'approve',
    extended: { permission: 'write' },
    actions: ['activate'],
  });
  return (
    <Box ref={ref}>
      <Text>Approve</Text>
    </Box>
  );
}

render(<Approve />);
```

`@termwright/probe-ink` reads these annotations when it is injected by the
launcher. Importing this SDK is optional: the probe also observes vanilla Ink
apps, and annotation registration does not require an active Termwright
session. The shared registry is process-local and weakly keyed by Ink host
objects, so unmounted hosts are not retained.

## API

- `useSemantic(ref, annotation)` attaches intent to an existing Ink host ref.
- `<Semantic role="…" name="…">…</Semantic>` clones its single Ink element child
  and attaches the same ref without adding a layout box.

Supported intent is `role`, `name`, `description`, `testId`, JSON `extended`
domain state, descriptive `actions`, and `labelledBy`/`describedBy` host refs.
Updates follow React reconciliation; relationships are refreshed after refs
attach and registrations are removed on unmount.

Annotations cannot set rendered text, bounds, visibility, focus, portable
framework state, or widget values. Those are physical/runtime facts and only
the injected probe may report them. Ink's retained `aria-role` and `aria-state`
are framework-native accessibility hints, kept separate from developer
annotations and reported with framework provenance.

## Physical evidence

Ink does not retain component names, `aria-label`, the active focus id, or
third-party input values on its host tree. The probe omits those facts rather
than allowing annotations to impersonate them. The exact-certified Ink
instrumentation correlates Yoga layout, nested overflow clipping, Static/live
origins, emitted output, and the committed VT buffer, so intended and visible
geometry are automatic for the frozen adapter contract. Exact pointer ownership
is a separate application-integrated capability: register the application's
production pointer provider before negotiation.

There is no public renderer wrapper, publisher, collector, or manual semantic
channel. Component tests use the same injected probe path as applications.

## Component tests

Use `mountInk` for fast in-process component tests:

```tsx
import { mountInk } from '@termwright/ink';

const harness = await mountInk(<Approve onApprove={spy} />);
await harness.press('Tab');
await harness.waitForQuiet();
await harness.press('Enter');
await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
await harness.close();
```

Use `launchInkFixture` when the test needs a real child process, PTY,
environment, signals, or process exit behavior.

|                             | `mountInk`                       | `launchInkFixture`          |
| --------------------------- | -------------------------------- | --------------------------- |
| process                     | current test process             | child process in a real PTY |
| props                       | any React props, including spies | bounded JSON                |
| rerender                    | React element                    | JSON props                  |
| process/env/signal fidelity | modelled                         | real                        |

Both modes return the standard `TerminalHarness`. Input is terminal input;
neither mode invokes component callbacks directly. Both resolve after the
first painted frame and semantic revision. Call `waitForQuiet()` between
input events that must be processed in separate commits.

`mountInk(element, options?)` returns an `InkHarness` with
`rerender(element)` and `renderError()`. `launchInkFixture(options)` returns an
`InkFixtureHarness` with `rerender(jsonProps)`.
