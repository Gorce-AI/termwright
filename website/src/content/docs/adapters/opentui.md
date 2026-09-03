---
title: OpenTUI
description: Use role-based locators and pointer actions with an OpenTUI application.
---

The OpenTUI integration observes the existing Renderable tree. It does not replace the
renderer or require application source changes.

## Install and launch

```sh
npm install --save-dev @termwright/probe-opentui
```

Keep `@termwright/probe-opentui` on the same release version as `termwright`.

```ts
import { fileURLToPath } from 'node:url';
import { withProbe } from '@termwright/probe-opentui';
import { test, expect } from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.ts', import.meta.url));

test('deploys a release', async ({ terminal }) => {
  const instrumented = withProbe('bun', ['bun', appPath]);
  const app = await terminal.launch({ command: instrumented.command });
  const deploy = app.getByRole('button', { name: 'Deploy' });
  await expect(deploy).toBeAttached();
  await deploy.click();
  await expect(app).toHaveText('Deployment started');
});
```

Bun is the normal OpenTUI runtime. Node works when the application itself runs
on Node. Bun 1.2.15 or newer and Node.js 22 or 24 are supported.

## Annotate a custom Renderable

Install the annotation package only when the application needs it:

```sh
npm install @termwright/opentui
```

Keep the annotation package on that release as well.

```ts
import { describeRenderable } from '@termwright/opentui';

const dispose = describeRenderable(deployment, {
  role: 'status',
  name: 'Deployment',
  testId: 'deployment',
  extended: { environment: 'staging' },
});
```

Annotations add intent. Text, focus, value, geometry, and display remain observed
framework facts. `describeRenderable()` returns the cleanup function shown as
`dispose`; call it when the Renderable is removed.

## Supported behavior

The integration exposes stable identity, display state, focus, values, intended
and clipped geometry, and the renderer's hit grid. This supports viewport
assertions and locator-based pointer input. The application must still enable
terminal mouse reporting before a click can be sent.

See [Framework compatibility](../../reference/compatibility/) for the current
tested versions; versions outside that list run without semantic locators.
