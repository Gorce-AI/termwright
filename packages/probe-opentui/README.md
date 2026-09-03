# @termwright/probe-opentui

Add semantic locators to an OpenTUI application tested with Termwright.

## Install

```sh
npm install --save-dev termwright @termwright/probe-opentui
```

Keep `termwright` and `@termwright/probe-opentui` on the same release version.

Supported OpenTUI versions are 0.5.3, 0.5.4, and 0.5.6 through 0.5.10. Use Bun
1.2.15 or newer, or Node.js 22 or 24 when the application itself supports Node.

## Launch with the probe

```ts
import { fileURLToPath } from 'node:url';
import { withProbe } from '@termwright/probe-opentui';
import { expect, test } from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.ts', import.meta.url));

test('shows the deploy button', async ({ terminal }) => {
  const { command } = withProbe('bun', ['bun', appPath]);
  const app = await terminal.launch({ command });

  await expect(app.getByRole('button', { name: 'Deploy' })).toBeAttached();
});
```

The probe observes the Renderable tree, focus, values, layout, viewport
clipping, and pointer targets. The application must enable terminal mouse
reporting before a locator click can be sent. Unsupported OpenTUI versions can
still run as black-box terminal tests but do not get semantic locators.

See the [OpenTUI integration guide](https://gorce-ai.github.io/termwright/adapters/opentui/)
for annotations and current limitations.
