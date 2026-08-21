---
title: Ink
description: Add semantic locators to an Ink 7 application with the Termwright integration.
---

Use the Ink integration when tests need roles, names, focus, and retained
component state. Plain terminal input and text assertions work without it.

## Install the integration

```sh
npm install --save-dev @termwright/probe-ink
```

```ts
import {fileURLToPath} from 'node:url';
import {withProbe} from '@termwright/probe-ink';
import {test, expect} from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.mjs', import.meta.url));

test('approves the request', async ({terminal}) => {
  const instrumented = withProbe('node', [process.execPath, appPath]);
  const app = await terminal.launch({command: instrumented.command});
  await app.press('Tab');
  await app.press('Enter');
  await expect(app).toHaveText('Approved');
});
```

Use `bun` instead of `process.execPath` when the application runs on Bun. The
preload is dormant outside a Termwright session.

## Verify semantic observation

```ts
await expect(app.getByRole('button', {name: 'Approve'})).toBeAttached();
```

The certified renderer instrumentation publishes intended and clipped geometry
automatically. Ink itself does not own a universal pointer router, so semantic
pointer actions additionally require an application evidence provider exposing
the application's production pointer regions and hit test. Termwright uses that
evidence only to plan coordinates; the input still travels through the PTY.
The runnable [Ink todo example](https://github.com/gorce-ai/termwright/tree/main/examples/ink-todo)
registers its measured production router with `@termwright/evidence-provider`.
Its E2E test clicks `getByRole('button', {name: 'Remove'})`, records the
provider-backed plan, and proves that Ink's normal stdin mouse handler changed
the application state.

## Annotate a custom component

Install `@termwright/ink` only when the host tree cannot express application
meaning:

```tsx
import {Box, Text, type DOMElement} from 'ink';
import {useRef} from 'react';
import {useSemantic} from '@termwright/ink';

export function Approve() {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, {role: 'button', name: 'Approve', testId: 'approve'});
  return <Box ref={ref}><Text>Approve</Text></Box>;
}
```

Annotations add role, name, description, test id, relationships, actions, and
JSON domain state. They cannot override rendered text, focus, geometry,
visibility, or framework-owned state.

`name` is the accessible name matched by
`getByRole(role, {name: ...})`. Use the portable roles that describe the
application contract, including `dialog`, `textbox`, `button`, `list`,
`listitem`, `status`, and `alert`:

```tsx
import {Semantic} from '@termwright/ink';

<Semantic role="dialog" name="Permission">
  <Box flexDirection="column">
    <Semantic role="button" name="Approve">
      <Box><Text>Approve</Text></Box>
    </Semantic>
  </Box>
</Semantic>
```

Ink's `Box` and `Text` types do not prove application intent. The integration
therefore does not infer interactive roles from their appearance. Annotate the
component when a role or accessible name is part of the behavior under test.

## Supported behavior

Ink 7.1.1 is certified exactly. Stable host identity, display state, rendered
text, retained ARIA state, intended geometry, and visible clipping are
automatic. The checksummed hooks correlate Yoga layout and nested overflow with
Static/live origins, emitted output, and the committed normal or alternate VT
buffer. Exact hit testing is application-integrated, not inferred from those
rectangles. See [Framework compatibility](../../reference/compatibility/) for
the generated operation matrix.
