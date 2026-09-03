---
title: Ink
description: Use role-based locators with an Ink application.
---

The Ink integration lets Termwright locate rendered components by role, name,
state, and test ID. You do not need it for terminal text assertions or keyboard
input.

## Install and launch

```sh
npm install --save-dev @termwright/probe-ink
```

Keep `@termwright/probe-ink` on the same release version as `termwright`.

Inject the probe when Termwright starts the application:

```ts
import { fileURLToPath } from 'node:url';
import { withProbe } from '@termwright/probe-ink';
import { test, expect } from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.mjs', import.meta.url));

test('approves the request', async ({ terminal }) => {
  const { command } = withProbe('node', [process.execPath, appPath]);
  const app = await terminal.launch({ command });
  const approve = app.getByRole('button', { name: 'Approve' });

  await expect(approve).toBeAttached();
  await app.press('Tab');
  await app.press('Enter');
  await expect(app).toHaveText('Approved');
});
```

For an Ink application that runs on Bun, use
`withProbe('bun', ['bun', appPath])`. The injected preload is inactive when the
application is started outside Termwright.

## Add meaning to custom components

Ink's `Box` and `Text` components do not say whether a region is a button,
dialog, or status message. Add an annotation when that meaning is part of the
behavior you want to test:

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

Install `@termwright/ink` only if the application uses these annotations. They
can describe roles, names, relationships, available actions, and application
state. Rendered text, focus, position, and visibility still come from Ink.

```sh
npm install @termwright/ink
```

Keep the annotation package on that release as well.

## Pointer input

Termwright automatically observes the layout and the part of each component
that is visible in the terminal viewport. Ink does not provide one standard
mouse hit-test API, so locator-based `click()` also needs two pieces of
application setup:

1. the application must enable terminal mouse reporting;
2. its production pointer router must be registered with
   `@termwright/evidence-provider`.

Without that setup, keyboard tests and semantic assertions still work, while a
locator-based pointer action fails with an explanation instead of guessing a
coordinate. See the runnable
[Ink todo example](https://github.com/gorce-ai/termwright/tree/main/examples/ink-todo)
for the complete mouse setup.

Termwright supports the Ink versions listed in
[Framework compatibility](../../reference/compatibility/). Other versions may
still run as black-box terminal tests, but do not get semantic locators.
The Node integration supports Node.js 22 and 24; the Bun integration requires
Bun 1.2.15 or newer.
