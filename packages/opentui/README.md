# @termwright/opentui

Optional, annotation-only semantics for an ordinary OpenTUI application.
`describeRenderable` associates developer intent with an existing Renderable;
it does not instrument or own the renderer.

```ts
import {BoxRenderable, createCliRenderer} from '@opentui/core';
import {describeRenderable} from '@termwright/opentui';

const renderer = await createCliRenderer();
const deployment = new BoxRenderable(renderer, {
  id: 'deployment',
  width: 24,
  height: 3,
});

const dispose = describeRenderable(deployment, {
  role: 'status',
  name: 'Deployment',
  testId: 'deployment',
  extended: {environment: 'staging'},
});

renderer.root.add(deployment);
// dispose() when the application no longer owns the annotation.
```

Launch the application normally through `@termwright/probe-opentui`. The probe
reads the process-local registry used by this SDK; registering an annotation
does not require an active Termwright session. Renderables are weakly keyed,
relationship targets use weak references, and the returned disposer cannot
delete a newer annotation installed by another owner.

Supported intent is `role`, `name`, `description`, `testId`, JSON `extended`
domain state, descriptive `actions`, and `labelledBy`/`describedBy`
relationships. Geometry, visibility, clipping, focus, rendered text, widget
value, selection and other framework/runtime state are exclusively observed by
the probe and cannot be overridden here.

There is deliberately no renderer instrumentation API, adapter mount helper,
publisher, collector, or manual semantic channel in this package.
