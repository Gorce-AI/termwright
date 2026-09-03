# @termwright/ink

Annotate Ink components and test them with an in-process terminal harness.

Most end-to-end suites install `termwright` and import component helpers from
`termwright/ink`. Install this focused package directly only when the project
does not need the Termwright CLI or Runner.

Keep this package on the same release version as `termwright` and
`@termwright/probe-ink`.

Install it as an application dependency when production source imports the
annotation API:

```sh
npm install @termwright/ink
```

## Add a semantic annotation

```tsx
import { Box, Text, type DOMElement } from 'ink';
import { useRef } from 'react';
import { useSemantic } from '@termwright/ink';

export function Approve() {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, { role: 'button', name: 'Approve' });

  return (
    <Box ref={ref}>
      <Text>Approve</Text>
    </Box>
  );
}
```

Annotations add application meaning such as roles, names, relationships,
actions, and JSON state. They do not override rendered text, focus, layout, or
visibility. `@termwright/probe-ink` reads them during an end-to-end test.

The package also exports `mountInk()` and `launchInkFixture()` for component
tests. See [Test Ink components](https://gorce-ai.github.io/termwright/guides/component-testing/)
for the complete fixture workflow and the
[Ink integration guide](https://gorce-ai.github.io/termwright/adapters/ink/)
for supported versions and pointer limitations.
