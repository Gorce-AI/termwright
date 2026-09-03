# @termwright/probe-ink

Add semantic locators to an Ink application tested with Termwright.

## Install

```sh
npm install --save-dev termwright @termwright/probe-ink
```

Keep `termwright` and `@termwright/probe-ink` on the same release version.

Ink 7.1.1 and React 19.2 or newer are supported. Run the application on Node.js
22 or 24, or Bun 1.2.15 or newer.

## Launch with the probe

```ts
import { fileURLToPath } from 'node:url';
import { withProbe } from '@termwright/probe-ink';
import { expect, test } from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.mjs', import.meta.url));

test('shows the approval button', async ({ terminal }) => {
  const { command } = withProbe('node', [process.execPath, appPath]);
  const app = await terminal.launch({ command });

  await expect(app.getByRole('button', { name: 'Approve' })).toBeAttached();
});
```

Use `withProbe('bun', ['bun', appPath])` for a Bun application. The preload is
inactive when the application runs outside a Termwright session.

The probe observes rendered Ink components, text, state, layout, and viewport
clipping. Ink has no standard pointer router, so locator clicks require extra
application setup; keyboard tests and semantic assertions do not.

See the [Ink integration guide](https://gorce-ai.github.io/termwright/adapters/ink/)
for annotations, mouse setup, tested behavior, and limitations.
