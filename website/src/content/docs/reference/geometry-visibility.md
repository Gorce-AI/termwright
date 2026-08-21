---
title: Geometry, visibility and pointer ownership
description: Evidence-qualified terminal layout assertions without false greens.
---

Termwright does not reduce “the framework did not tell us” to `false`. Every
layout fact is an `Observation<T>` with one of four states:

- `known(value, evidence)` — the value and its provenance are available;
- `absent(reason, evidence)` — authoritative evidence proves the node is detached, not displayed or not laid out;
- `unknown(reason)` — only a revision pair, provider refresh or stale revision is temporarily unsettled;
- `unsupported(capability, reason)` — outside the frozen session contract.

Use `locator.geometry()`, `locator.visibility()` and `locator.hitTest()`. Their
results carry one atomic stamp: session id, screen revision and semantic
revision. There is no boolean visibility shortcut: callers must handle the
qualified observation or use a matcher that does so.

Rectangles use zero-based terminal cells and half-open edges. A rectangle at
`column: 2, width: 3` owns columns 2, 3 and 4. A box beginning at column 5 is
adjacent, not overlapping. `visibleRect` and `intendedRect` are separate facts;
relative and viewport coordinate spaces cannot be compared.

Matchers may poll a transient `unknown`, fail immediately on `unsupported`, and require known
evidence for both positive and negated assertions. Therefore neither
`toBeVisible()` nor `.not.toBeVisible()` can pass merely because clipping was
unobservable. Available assertions include `toBeAttached`, `toBeDetached`,
`toBeDisplayed`, `toBeHidden`, `toBeVisible`, `toBeOffscreen`, `toBeInViewport({ ratio, fully })`,
`toReceivePointerEvents`, `toHaveBounds` and `toHaveSpatialRelation`.
An omitted viewport ratio means “any non-zero intersection”; an explicit
`ratio` is an inclusive minimum from `0` through `1`.
Spatial assertions additionally require both locators to come from the same
session, observation revision and known coordinate space.

<!-- geometry-matrices:start -->
## Framework capability matrix

The compatibility registry classifies facts as `automatic`, `application-integrated`, or `unsupported`. Runtime requirements are listed separately below.

| Framework | Identity | Displayed | Intended rect | Visible rect | Exact hit test | Why |
| --- | --- | --- | --- | --- | --- | --- |
| Generic grid | none | automatic | automatic | automatic | automatic | Grid matches are terminal cells. Exact pointer delivery additionally requires application mouse reporting. |
| Ink | stable | automatic | automatic | automatic | application-integrated | Checksummed Ink 7.1.1 renderer and frame hooks retain Yoga layout, nested overflow clipping, Static/live origins, and the exact committed VT buffer. Pointer ownership remains independent and requires an application evidence provider. |
| OpenTUI | stable | automatic | automatic | automatic | automatic | The certified 0.5.3 render-command hook records ancestor scissor intersections at the committed frame boundary; native hitTest supplies pointer recipients independently. |
| Textual | stable | automatic | automatic | automatic | automatic | The compositor exposes display state, intended and clipped regions, and the same fresh pointer-routing lookup used by Textual. |
| tview | stable | automatic | unsupported | unsupported | application-integrated | The instrumented tree exposes display state. Primitive rectangles remain diagnostic because synthetic List and DropDown items lack universal intended geometry, while an application evidence provider can expose the production pointer router authoritatively. |
| Ratatui | frame-local | unsupported | automatic | unsupported | application-integrated | Instrumented render calls expose intended areas. Ratatui does not retain per-widget display, clipping, paint ownership, or pointer recipients automatically; its application evidence SDK can expose the production router authoritatively. |
| Bubble Tea / Bubbles | frame-local | unsupported | unsupported | unsupported | application-integrated | Bubble Tea hands the renderer a styled string without automatic attributable component geometry or pointer ownership. Its application evidence SDK can expose the production router authoritatively. |

## Action and assertion matrix

| Framework | Keyboard | Pointer | Attached | Detached | Displayed | Hidden | Visible | Offscreen | In viewport | Receives pointer | Bounds | Spatial | Cell snapshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Generic grid | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic |
| Ink | automatic | application-integrated | automatic | automatic | automatic | automatic | automatic | automatic | automatic | application-integrated | automatic | automatic | automatic |
| OpenTUI | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic |
| Textual | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic |
| tview | automatic | application-integrated | automatic | automatic | automatic | automatic | unsupported | unsupported | unsupported | application-integrated | unsupported | unsupported | unsupported |
| Ratatui | automatic | application-integrated | automatic | automatic | unsupported | unsupported | unsupported | unsupported | unsupported | application-integrated | automatic | automatic | unsupported |
| Bubble Tea / Bubbles | automatic | application-integrated | automatic | automatic | unsupported | unsupported | unsupported | unsupported | unsupported | application-integrated | unsupported | unsupported | unsupported |

## Exact certifications

| Framework | Certification ID | Instrumentation policy | Checksum source of truth |
| --- | --- | --- | --- |
| Ink | ink@7.1.1/0.2.0 | checksummed-instrumentation | `packages/probe-ink/src/certified-instrumentation.json` |
| OpenTUI | opentui@0.5.3/0.2.0 | checksummed-instrumentation | `packages/probe-opentui/src/certified-instrumentation.json` |
| Textual | textual@8.2.8/0.2.0 | native-hook | native hook |
| tview | tview@v0.42.0/0.2.0 | checksummed-replacement | `packages/probe-tview/upstream-patches/tview/v0.42.0/manifest.json` |
| Ratatui | ratatui@0.30.2/0.2.0 | checksummed-replacement | `clients/rust-probe/upstream-patches/ratatui-core/0.1.2/manifest.json`<br>`clients/rust-probe/upstream-patches/ratatui-widgets/0.3.2/manifest.json` |
| Bubble Tea / Bubbles | charm@v1.3.10/0.2.0<br>charm@v2.0.8/0.2.0 | checksummed-replacement | `packages/probe-charm/upstream-patches/bubbletea/v1.3.10/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbletea/v2.0.8/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbles/v1.0.0/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbles/v2.1.1/manifest.json` |

## Application-integrated capability providers

| Framework | Accepted provider types | Extendable capabilities | SDKs |
| --- | --- | --- | --- |
| Ink | pointer-evidence | pointer-geometry, pointer-hit-testing | `@termwright/evidence-provider` |
| OpenTUI | pointer-evidence | pointer-geometry, pointer-hit-testing | `@termwright/evidence-provider` |
| Textual | pointer-evidence | pointer-geometry, pointer-hit-testing | `termwright` |
| tview | pointer-evidence | pointer-geometry, pointer-hit-testing | `github.com/gorce-ai/termwright/clients/go/evidence` |
| Ratatui | pointer-evidence | pointer-geometry, pointer-hit-testing | `termwright-protocol`, `termwright-ratatui` |
| Bubble Tea / Bubbles | pointer-evidence | pointer-geometry, pointer-hit-testing | `github.com/gorce-ai/termwright/clients/go/evidence` |

## Executable conformance coverage

| Framework | Covered areas | Real fixtures |
| --- | --- | --- |
| Ink | semantic-tree, geometry, provider-pointer-pty, dormant-byte-parity | `packages/probe-ink/src/geometry.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts` |
| OpenTUI | semantic-tree, clipping, native-hit-testing, dormant-byte-parity | `packages/probe-opentui/src/zero-config.test.ts`<br>`packages/probe-opentui/src/instrumentation.test.ts` |
| Textual | semantic-tree, compositor-geometry, native-hit-testing, injection | `clients/python/tests/test_textual_probe_hook.py`<br>`clients/python/tests/test_probe_tree.py` |
| tview | semantic-tree, exact-patch, application-pointer-provider, dormant-byte-parity | `packages/probe-tview/src/zero-config.pty.test.ts` |
| Ratatui | immediate-mode-identity, exact-patch, application-pointer-provider, real-pty-input | `clients/rust-probe/tests/patchset.rs`<br>`examples/ratatui-list/tests/app.e2e.test.ts` |
| Bubble Tea / Bubbles | model-semantics, exact-patch, application-pointer-provider, real-pty-input | `packages/probe-charm/src/zero-config.pty.test.ts`<br>`examples/bubbletea-login/tests/app.e2e.test.ts` |

### Runtime preconditions

- **Generic grid — pointerActions:** The application enables terminal mouse reporting before pointer input is sent.
- **Ink — hitTest:** The application registers an authoritative production pointer router before the probe handshake.
- **tview — hitTest:** The application registers its authoritative production pointer router before capability negotiation.
- **tview — pointerActions:** Terminal mouse reporting is enabled for the requested pointer action.
- **Ratatui — hitTest:** The application registers its authoritative production pointer router before capability negotiation.
- **Ratatui — pointerActions:** Terminal mouse reporting is enabled for the requested pointer action.
- **Bubble Tea / Bubbles — hitTest:** The application registers its authoritative production pointer router before capability negotiation.
- **Bubble Tea / Bubbles — pointerActions:** Bubble Tea enables terminal mouse reporting for the requested pointer action.
- **Ink — keyboard-input:** A writable real PTY is attached.
- **Ink — pointer-input:** Terminal mouse modes are observable and the application enables mouse reporting.
- **OpenTUI — keyboard-input:** A writable real PTY is attached.
- **OpenTUI — pointer-input:** Terminal mouse modes are observable and the application enables mouse reporting.
- **Textual — keyboard-input:** A writable real PTY is attached.
- **Textual — pointer-input:** Terminal mouse modes are observable and Textual enables mouse reporting.
- **tview — keyboard-input:** A writable real PTY is attached.
- **tview — pointer-input:** Terminal mouse modes are observable and the application enables mouse reporting.
- **Ratatui — keyboard-input:** A writable real PTY is attached.
- **Ratatui — pointer-input:** An application pointer provider is registered before negotiation and the application enables terminal mouse reporting.
- **Bubble Tea / Bubbles — keyboard-input:** A writable real PTY is attached.
- **Bubble Tea / Bubbles — pointer-input:** An application pointer provider is registered before negotiation and Bubble Tea mouse reporting is enabled.
<!-- geometry-matrices:end -->

Every semantic snapshot uses the evidence-qualified v2 schema. A producer
announces `intended-geometry` or `clipped-geometry` only for the corresponding
authoritative framework fact. A producer that can publish a complete pointer
map announces `pointer-hit-grid`; other producers publish an `unsupported`
hit-grid observation rather than guessed ownership. Settled snapshots never
use `unknown` as a permanent substitute for missing framework evidence. Geometry and visibility observations are
required regardless of capability claims.

`resize()` returns a receipt containing the requested dimensions, before/after
observation stamps and the paired render revision. A missing repaint is a
timeout; it is never swallowed.
