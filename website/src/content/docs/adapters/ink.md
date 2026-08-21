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

Prefer keyboard input for Ink. The framework does not expose clipping or exact
pointer ownership, so semantic `click()` is unsupported.

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

## Supported behavior

Ink 7.1 is verified. Stable host identity, display state, rendered text, and
retained ARIA state are observable. Intended geometry is conditional; visible
clipping and hit testing are unsupported. See
[Framework compatibility](../../reference/compatibility/) for the operation matrix.
