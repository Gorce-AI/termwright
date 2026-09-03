# @termwright/opentui

Add application-specific roles, names, relationships, or state to OpenTUI
Renderables observed by `@termwright/probe-opentui`.

Keep this package on the same release version as `termwright` and
`@termwright/probe-opentui`.

Install it as an application dependency when production source imports the
annotation API:

```sh
npm install @termwright/opentui
```

```ts
import { describeRenderable } from '@termwright/opentui';

const dispose = describeRenderable(deployment, {
  role: 'status',
  name: 'Deployment',
  testId: 'deployment',
  extended: { environment: 'staging' },
});

// Call dispose() when the application removes the Renderable.
```

Annotations add meaning but do not override text, focus, value, layout,
visibility, or pointer behavior reported by OpenTUI. The package does not start
or instrument the renderer; launch the application through
`@termwright/probe-opentui` in the test.

See the [OpenTUI integration guide](https://gorce-ai.github.io/termwright/adapters/opentui/)
for installation, a complete test, supported versions, and limitations.
