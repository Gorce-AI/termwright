# @termwright/evidence-provider

Application-side SDK for publishing revision-bound physical evidence from the
same production pointer router that handles terminal mouse input.

Register providers before the framework probe negotiates its session contract:

```ts
import {registerEvidenceProvider} from '@termwright/evidence-provider';

registerEvidenceProvider({
  id: 'my-app-pointer',
  version: '1',
  method: 'native',
  capabilities: ['pointer-regions', 'hit-test'],
  observe({columns, rows}) {
    const regions = productionMouseRouter.regions({columns, rows});
    return {
      pointerRegions: regions.map(({testId, bounds, spans}) => ({
        recipient: {testId},
        regionBounds: bounds,
        spans,
      })),
      hitTest(column, row) {
        const target = productionMouseRouter.hitTest(column, row);
        return target === null ? null : {testId: target.testId};
      },
    };
  },
});
```

The provider supplies evidence only. Termwright never calls the application's
dispatch handler: Locator actions select a proven terminal cell and send real
mouse protocol bytes through the PTY, so the application receives its normal
production input.

Capabilities freeze during negotiation. Disposing a registered provider after
that point reports provider loss and fails closed; inconsistent regions or hit
tests report a provider violation. A semantic annotation is not an evidence
provider and cannot claim geometry or pointer ownership.

The two pointer facts are independently composable. An application may expose
only explicit authoritative regions with `capabilities: ['pointer-regions']`,
only its production router with `capabilities: ['hit-test']`, or both from one
provider. When they are independent, Termwright joins them by committed
revision and verifies every declared region against the negotiated hit test.
It never treats region bounds as an implicit hit test.

Use `createEvidenceProviderRegistry()` when one process hosts multiple isolated
applications. The default `registerEvidenceProvider()` facade is process-local
and intended for ordinary one-application processes.
