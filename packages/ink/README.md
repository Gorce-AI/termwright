# @termwright/ink

Optional, annotation-only semantics for ordinary Ink applications. This
package does not render the application, open a transport, or own a probe.
Keep the normal Ink entry point:

```tsx
import {render, Box, Text, type DOMElement} from 'ink';
import {useRef} from 'react';
import {useSemantic} from '@termwright/ink';

function Approve() {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, {
    role: 'button',
    name: 'Approve',
    description: 'Accept the pending change',
    testId: 'approve',
    extended: {permission: 'write'},
    actions: ['activate'],
  });
  return <Box ref={ref}><Text>Approve</Text></Box>;
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

## Limits

Ink does not retain component names, `aria-label`, the active focus id, or
third-party input values on its host tree. The probe omits those facts rather
than allowing annotations to impersonate them. Bounds are available only when
the probe can establish terminal-absolute geometry; see
`@termwright/probe-ink` for the exact conditions.

There is deliberately no renderer wrapper, provider, publisher, collector, or
manual semantic channel in this package.
