# @termwright/evidence-provider

Application-side SDK for publishing revision-bound authoritative facts from
the application's production pointer router, focus manager, viewport model,
painter, and keybindings.

Register providers before the framework probe negotiates its session contract:

```ts
import { registerPointerEvidenceProvider } from "@termwright/evidence-provider";

registerPointerEvidenceProvider({
  id: "my-app-pointer",
  version: "1",
  method: "native",
  family: "pointer",
  capabilities: ["pointer-regions", "hit-test"],
  observe({ columns, rows }) {
    const regions = productionMouseRouter.regions({ columns, rows });
    return {
      pointerRegions: regions.map(({ testId, bounds, spans }) => ({
        recipient: { testId },
        regionBounds: bounds,
        spans,
      })),
      hitTest(column, row) {
        const target = productionMouseRouter.hitTest(column, row);
        return target === null ? null : { testId: target.testId };
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

Focus and execution strategy are deliberately separate provider families. A
focus provider observes the production focus manager; an action-strategy
provider publishes data-only physical input recipes. Termwright can therefore
prove the postcondition while still sending every key through the real PTY:

```ts
import {
  registerActionStrategyProvider,
  registerFocusEvidenceProvider,
} from "@termwright/evidence-provider";

registerFocusEvidenceProvider({
  id: "my-app-focus",
  version: "1",
  method: "native",
  family: "focus",
  observe() {
    const target = productionFocusManager.current();
    return { focused: target === null ? null : { testId: target.testId } };
  },
});

registerActionStrategyProvider({
  id: "my-app-keys",
  version: "1",
  method: "native",
  family: "action-strategy",
  observe() {
    return { actionRecipes: productionFocusManager.termwrightRecipes() };
  },
});
```

On the wire, focus uses a closed `focused | none` result. An unnegotiated
provider, a focused recipient, and the authoritative fact that no node owns
focus cannot collapse into the same value. Multiple providers may co-prove an
identical result; disagreement is a contract violation.

Application scrolling is a separate evidence domain from emulator scrollback.
Publish the production viewport in application-defined logical units; axis,
offset, visible viewport and total extent travel together in one committed
semantic revision:

```ts
import { registerScrollEvidenceProvider } from "@termwright/evidence-provider";

registerScrollEvidenceProvider({
  id: "my-app-scroll",
  version: "1",
  method: "native",
  family: "scroll",
  observe() {
    const viewport = productionList.viewport();
    return {
      scrollStates: [
        {
          recipient: { testId: "results" },
          axis: "vertical",
          offset: viewport.firstVisibleItem,
          viewport: viewport.visibleItemCount,
          extent: viewport.itemCount,
        },
      ],
    };
  },
});

const observed = await terminal.getByTestId("results").semanticScroll();
```

`offset + viewport` may not exceed `extent`. Duplicate providers may co-prove
the same fact, but disagreement is a typed evidence conflict; registration
order never wins.

Paint evidence is deliberately separate from layout, clipping, and pointer
ownership. Publish only cells attributed by the application's real production
painter; a rectangle inferred from widget geometry is not paint evidence:

```ts
import { registerPaintEvidenceProvider } from "@termwright/evidence-provider";

registerPaintEvidenceProvider({
  id: "my-app-painter",
  version: "1",
  method: "native",
  family: "paint",
  observe() {
    return {
      paintedRegions: productionPainter.attribution().map((paint) => ({
        recipient: { testId: paint.testId },
        regionBounds: paint.bounds,
        spans: paint.rowSpans,
      })),
    };
  },
});

const painted = await terminal.getByTestId("results").paintedRegion();
```

Spans are canonical non-overlapping half-open row runs, must stay inside their
declared bounds and viewport, and are tied to the exact committed semantic
revision. Conflicting authoritative painters produce `evidence-conflict`;
Termwright never chooses the provider registered last.

Terminal input modes are evidence about the application's production parser,
not a request to enable guessed terminal behavior. This provider is useful
when a transport such as ConPTY consumes or hides DEC mode sequences from the
host. Termwright still sends mouse and focus bytes through the real PTY:

```ts
import { registerTerminalInputModeEvidenceProvider } from "@termwright/evidence-provider";

registerTerminalInputModeEvidenceProvider({
  id: "my-app-input-parser",
  version: "1",
  method: "native",
  family: "input-mode",
  observe() {
    return { inputModes: productionParser.termwrightInputModes() };
  },
});
```

`mouseTracking`, `mouseEncoding`, and `focusReporting` are one closed,
revision-bound tuple. If VT observation is available it must agree exactly;
conflict or provider loss fails closed before further mode-dependent input.

Use `createEvidenceProviderRegistry()` when one process hosts multiple isolated
applications. The typed pointer, focus, scroll, paint, input-mode, and
action-strategy facades are process-local and intended for
ordinary one-application processes. There is deliberately no generic JSON
provider escape hatch.
