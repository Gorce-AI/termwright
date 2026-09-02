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
## Framework capability graph

Every value below is generated from the executable capability graph and the exact certification row. `automatic`, `application-integrated`, and `unsupported` describe authoritative evidence sources; runtime prerequisites are separate.

| Framework | Semantic tree | Stable identity | Intended geometry | Clipped geometry | Painted region | Pointer region | Hit testing | Focus | Scroll | Render order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ink | automatic | automatic | automatic | automatic | application-integrated | application-integrated | application-integrated | application-integrated | application-integrated | unsupported |
| OpenTUI | automatic | automatic | automatic | automatic | application-integrated | automatic | automatic | automatic | application-integrated | unsupported |
| Textual | automatic | automatic | automatic | automatic | application-integrated | automatic | automatic | automatic | application-integrated | automatic |
| tview | automatic | automatic | automatic | unsupported | application-integrated | application-integrated | application-integrated | automatic | application-integrated | unsupported |
| Ratatui | automatic | unsupported | automatic | unsupported | application-integrated | application-integrated | application-integrated | application-integrated | application-integrated | unsupported |
| Bubble Tea / Bubbles | automatic | unsupported | unsupported | unsupported | application-integrated | application-integrated | application-integrated | automatic | application-integrated | unsupported |

## Derived public surface

Public availability is computed by traversing the same graph used by certification. Diagnostic evidence never unlocks an action.

| Framework | Semantic query | Visible | Click | Hover | Drag | Focus | Activate | Type | Fill | Checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ink | automatic | automatic | application-integrated | application-integrated | application-integrated | automatic | automatic | application-integrated | automatic | automatic |
| OpenTUI | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic |
| Textual | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic | automatic |
| tview | automatic | unsupported | application-integrated | application-integrated | application-integrated | automatic | automatic | automatic | automatic | automatic |
| Ratatui | automatic | unsupported | application-integrated | application-integrated | application-integrated | automatic | automatic | application-integrated | automatic | automatic |
| Bubble Tea / Bubbles | automatic | unsupported | application-integrated | application-integrated | application-integrated | automatic | automatic | automatic | automatic | automatic |

## Certification contracts

| Framework | Certification ID | Instrumentation policy | Checksum source of truth |
| --- | --- | --- | --- |
| Ink | ink@7.1.1/0.3.1 | checksummed-instrumentation | `packages/probe-ink/src/certified-instrumentation.json` |
| OpenTUI | opentui@0.5.3/0.3.1<br>opentui@0.5.4/0.3.1<br>opentui@0.5.6/0.3.1<br>opentui@0.5.7/0.3.1<br>opentui@0.5.8/0.3.1<br>opentui@0.5.9/0.3.1<br>opentui@0.5.10/0.3.1 | runtime-capability-and-behavior | `packages/probe-opentui/src/certified-runtime.json` |
| Textual | textual@runtime-capability/0.3.1 | runtime-capability-and-behavior | not applicable (capability certification) |
| tview | tview@compile-capability/0.3.1 | compile-and-behavioral-capability | not applicable (capability certification) |
| Ratatui | ratatui@0.30.2/0.3.1 | checksummed-replacement | `clients/rust-probe/upstream-patches/ratatui-core/0.1.2/manifest.json`<br>`clients/rust-probe/upstream-patches/ratatui-crossterm/0.1.2/manifest.json`<br>`clients/rust-probe/upstream-patches/ratatui-widgets/0.3.2/manifest.json` |
| Bubble Tea / Bubbles | charm@v1.3.10/0.3.1<br>charm@v2.0.8/0.3.1<br>charm@v2.0.9/0.3.1 | checksummed-replacement | `packages/probe-charm/upstream-patches/bubbles/v1.0.0/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbles/v2.1.1/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbletea/v1.3.10/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbletea/v2.0.8/manifest.json`<br>`packages/probe-charm/upstream-patches/bubbletea/v2.0.9/manifest.json` |

## Application-integrated providers

| Framework | Accepted provider types | Extended session capabilities | SDKs |
| --- | --- | --- | --- |
| Ink | pointer-evidence, action-strategy, focus-evidence, scroll-evidence, paint-evidence, input-mode-evidence | pointer-geometry, pointer-hit-testing, action-strategies, focus, scroll, painted-region, pointer-input, focus-input | `@termwright/evidence-provider`, `/evidence-provider` |
| OpenTUI | action-strategy, scroll-evidence, paint-evidence, input-mode-evidence | action-strategies, scroll, painted-region, pointer-input, focus-input | `@termwright/evidence-provider`, `/evidence-provider` |
| Textual | action-strategy, scroll-evidence, paint-evidence, input-mode-evidence | action-strategies, scroll, painted-region, pointer-input, focus-input | `termwright`, `/evidence-provider` |
| tview | pointer-evidence, scroll-evidence, paint-evidence, input-mode-evidence | pointer-geometry, pointer-hit-testing, scroll, painted-region, pointer-input, focus-input | `github.com/gorce-ai/termwright/clients/go/evidence`, `/evidence-provider` |
| Ratatui | pointer-evidence, action-strategy, focus-evidence, scroll-evidence, paint-evidence, input-mode-evidence | pointer-geometry, pointer-hit-testing, action-strategies, focus, scroll, painted-region, pointer-input, focus-input | `termwright-protocol`, `termwright-ratatui`, `/evidence-provider` |
| Bubble Tea / Bubbles | pointer-evidence, action-strategy, scroll-evidence, paint-evidence, input-mode-evidence | pointer-geometry, pointer-hit-testing, action-strategies, scroll, painted-region, pointer-input, focus-input | `github.com/gorce-ai/termwright/clients/go/evidence`, `/evidence-provider` |

## Executable conformance claims

| Framework | Mandatory claim IDs | Executable files |
| --- | --- | --- |
| Ink | `claim.semantic-tree-authoritative`<br>`claim.stable-identity-authoritative`<br>`claim.intended-geometry-authoritative`<br>`claim.clipped-geometry-authoritative`<br>`claim.paired-revisions`<br>`claim.pointer-region-authoritative`<br>`claim.pointer-hit-test-authoritative`<br>`claim.keyboard-real-pty`<br>`claim.pointer-real-pty`<br>`claim.focus-report-real-pty`<br>`claim.focus-authoritative`<br>`claim.action-strategy-authoritative`<br>`claim.scroll-authoritative`<br>`claim.painted-region-authoritative` | `packages/probe-ink/src/geometry.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts`<br>`examples/ink-todo/tests/app.e2e.test.ts`<br>`packages/conformance/src/suites/driver-generic.test.ts`<br>`packages/driver/src/session.pty.test.ts`<br>`packages/driver/src/provider-evidence.test.ts`<br>`packages/evidence-provider/src/index.test.ts` |
| OpenTUI | `claim.semantic-tree-authoritative`<br>`claim.stable-identity-authoritative`<br>`claim.intended-geometry-authoritative`<br>`claim.clipped-geometry-authoritative`<br>`claim.pointer-region-authoritative`<br>`claim.pointer-hit-test-authoritative`<br>`claim.paired-revisions`<br>`claim.keyboard-real-pty`<br>`claim.pointer-real-pty`<br>`claim.focus-report-real-pty`<br>`claim.focus-authoritative`<br>`claim.action-strategy-authoritative`<br>`claim.scroll-authoritative`<br>`claim.painted-region-authoritative` | `packages/probe-opentui/src/zero-config.test.ts`<br>`packages/probe-opentui/src/runtime-observer.test.ts`<br>`packages/conformance/src/suites/driver-generic.test.ts`<br>`packages/conformance/src/suites/interaction.test.ts`<br>`packages/driver/src/session.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts`<br>`packages/driver/src/provider-evidence.test.ts`<br>`packages/evidence-provider/src/index.test.ts` |
| Textual | `claim.semantic-tree-authoritative`<br>`claim.stable-identity-authoritative`<br>`claim.intended-geometry-authoritative`<br>`claim.clipped-geometry-authoritative`<br>`claim.pointer-region-authoritative`<br>`claim.pointer-hit-test-authoritative`<br>`claim.render-order-authoritative`<br>`claim.paired-revisions`<br>`claim.keyboard-real-pty`<br>`claim.pointer-real-pty`<br>`claim.focus-report-real-pty`<br>`claim.focus-authoritative`<br>`claim.action-strategy-authoritative`<br>`claim.scroll-authoritative`<br>`claim.painted-region-authoritative` | `clients/python/tests/test_textual_probe_hook.py`<br>`clients/python/tests/test_probe_tree.py`<br>`packages/conformance/src/suites/driver-generic.test.ts`<br>`packages/conformance/src/suites/interaction.test.ts`<br>`packages/driver/src/session.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts`<br>`clients/python/tests/test_textual_annotations.py`<br>`packages/driver/src/provider-evidence.test.ts`<br>`clients/python/tests/test_evidence.py` |
| tview | `claim.semantic-tree-authoritative`<br>`claim.stable-identity-authoritative`<br>`claim.intended-geometry-authoritative`<br>`claim.paired-revisions`<br>`claim.pointer-region-authoritative`<br>`claim.pointer-hit-test-authoritative`<br>`claim.keyboard-real-pty`<br>`claim.pointer-real-pty`<br>`claim.focus-report-real-pty`<br>`claim.focus-authoritative`<br>`claim.action-strategy-authoritative`<br>`claim.scroll-authoritative`<br>`claim.painted-region-authoritative` | `packages/probe-tview/src/zero-config.pty.test.ts`<br>`packages/conformance/src/suites/driver-generic.test.ts`<br>`packages/driver/src/session.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts`<br>`clients/go/evidence/registry_test.go`<br>`packages/driver/src/provider-evidence.test.ts` |
| Ratatui | `claim.semantic-tree-authoritative`<br>`claim.intended-geometry-authoritative`<br>`claim.paired-revisions`<br>`claim.pointer-region-authoritative`<br>`claim.pointer-hit-test-authoritative`<br>`claim.keyboard-real-pty`<br>`claim.pointer-real-pty`<br>`claim.focus-report-real-pty`<br>`claim.focus-authoritative`<br>`claim.action-strategy-authoritative`<br>`claim.scroll-authoritative`<br>`claim.painted-region-authoritative` | `clients/rust-probe/tests/patchset.rs`<br>`examples/ratatui-list/tests/app.e2e.test.ts`<br>`packages/conformance/src/suites/driver-generic.test.ts`<br>`packages/driver/src/session.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts`<br>`packages/driver/src/provider-evidence.test.ts`<br>`clients/rust/tests/evidence.rs` |
| Bubble Tea / Bubbles | `claim.semantic-tree-authoritative`<br>`claim.paired-revisions`<br>`claim.pointer-region-authoritative`<br>`claim.pointer-hit-test-authoritative`<br>`claim.keyboard-real-pty`<br>`claim.pointer-real-pty`<br>`claim.focus-report-real-pty`<br>`claim.focus-authoritative`<br>`claim.action-strategy-authoritative`<br>`claim.scroll-authoritative`<br>`claim.painted-region-authoritative` | `packages/probe-charm/src/zero-config.pty.test.ts`<br>`examples/bubbletea-login/tests/app.e2e.test.ts`<br>`packages/conformance/src/suites/driver-generic.test.ts`<br>`packages/driver/src/session.pty.test.ts`<br>`packages/probe-ink/src/provider.pty.test.ts`<br>`packages/driver/src/provider-evidence.test.ts`<br>`clients/go/evidence/registry_test.go` |

### Runtime prerequisites and generated remediation

- **Ink — keyboard-input / writable-pty:** Launch or retain a writable PTY.
- **Ink — pointer-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Ink — pointer-input / mouse-reporting-enabled:** Enable terminal mouse reporting in the application.
- **Ink — focus-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Ink — focus-input / focus-reporting-enabled:** Enable terminal focus reporting in the application.
- **OpenTUI — keyboard-input / writable-pty:** Launch or retain a writable PTY.
- **OpenTUI — pointer-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **OpenTUI — pointer-input / mouse-reporting-enabled:** Enable terminal mouse reporting in the application.
- **OpenTUI — focus-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **OpenTUI — focus-input / focus-reporting-enabled:** Enable terminal focus reporting in the application.
- **Textual — keyboard-input / writable-pty:** Launch or retain a writable PTY.
- **Textual — pointer-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Textual — pointer-input / mouse-reporting-enabled:** Enable terminal mouse reporting in the application.
- **Textual — focus-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Textual — focus-input / focus-reporting-enabled:** Enable terminal focus reporting in the application.
- **tview — keyboard-input / writable-pty:** Launch or retain a writable PTY.
- **tview — pointer-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **tview — pointer-input / mouse-reporting-enabled:** Enable terminal mouse reporting in the application.
- **tview — focus-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **tview — focus-input / focus-reporting-enabled:** Enable terminal focus reporting in the application.
- **Ratatui — keyboard-input / writable-pty:** Launch or retain a writable PTY.
- **Ratatui — pointer-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Ratatui — pointer-input / mouse-reporting-enabled:** Enable terminal mouse reporting in the application.
- **Ratatui — focus-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Ratatui — focus-input / focus-reporting-enabled:** Enable terminal focus reporting in the application.
- **Bubble Tea / Bubbles — keyboard-input / writable-pty:** Launch or retain a writable PTY.
- **Bubble Tea / Bubbles — pointer-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Bubble Tea / Bubbles — pointer-input / mouse-reporting-enabled:** Enable terminal mouse reporting in the application.
- **Bubble Tea / Bubbles — focus-input / terminal-input-modes-authoritative:** Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.
- **Bubble Tea / Bubbles — focus-input / focus-reporting-enabled:** Enable terminal focus reporting in the application.
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
