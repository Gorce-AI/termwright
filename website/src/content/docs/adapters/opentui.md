---
title: OpenTUI
description: Observe OpenTUI Renderables with stable semantic identity and intended geometry.
---

The OpenTUI integration observes the existing Renderable tree. It does not replace the
renderer or require application source changes.

## Install and launch

```sh
npm install --save-dev @termwright/probe-opentui
```

```ts
import {fileURLToPath} from 'node:url';
import {withProbe} from '@termwright/probe-opentui';
import {test, expect} from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.ts', import.meta.url));

test('deploys a release', async ({terminal}) => {
  const instrumented = withProbe('bun', ['bun', appPath]);
  const app = await terminal.launch({command: instrumented.command});
  const deploy = app.getByRole('button', {name: 'Deploy'});
  await expect(deploy).toBeAttached();
  await deploy.click();
});
```

Bun is the normal OpenTUI runtime. Node works when the application itself runs
on Node.

## Annotate a custom Renderable

```ts
import {describeRenderable} from '@termwright/opentui';

const dispose = describeRenderable(deployment, {
  role: 'status',
  name: 'Deployment',
  testId: 'deployment',
  extended: {environment: 'staging'},
});
```

Annotations add intent. Text, focus, value, geometry, and display remain observed
framework facts.

## Supported behavior

OpenTUI 0.5.3 is verified. The runtime observer captures stable identity,
effective display, focus, values, intended and ancestor-clipped geometry, plus
the renderer's authoritative hit grid. Viewport visibility and pointer target
selection therefore use framework evidence. Sending pointer input additionally
requires the session's normal terminal-mode prerequisites, including observed
mouse reporting; that runtime prerequisite is separate from hit-test fidelity.

See [Framework compatibility](../../reference/compatibility/) for current versions.
