---
title: Geometry, visibility and pointer ownership
description: Evidence-qualified terminal layout assertions without false greens.
---

Termwright does not reduce “the framework did not tell us” to `false`. Every
layout fact is an `Observation<T>` with one of four states:

- `known(value, evidence)` — safe to assert;
- `absent(reason)` — the node is detached, not displayed or not laid out;
- `unknown(reason)` — retryable missing evidence;
- `unsupported(capability, reason)` — the framework cannot provide the fact.

Use `locator.geometry()`, `locator.visibility()` and `locator.hitTest()`. Their
results carry one atomic stamp: session id, screen revision and semantic
revision. There is no boolean visibility shortcut: callers must handle the
qualified observation or use a matcher that does so.

Rectangles use zero-based terminal cells and half-open edges. A rectangle at
`column: 2, width: 3` owns columns 2, 3 and 4. A box beginning at column 5 is
adjacent, not overlapping. `visibleRect` and `intendedRect` are separate facts;
relative and viewport coordinate spaces cannot be compared.

Matchers poll `unknown`, fail immediately on `unsupported`, and require known
evidence for both positive and negated assertions. Therefore neither
`toBeVisible()` nor `.not.toBeVisible()` can pass merely because clipping was
unobservable. Available assertions include `toBeAttached`, `toBeDetached`,
`toBeDisplayed`, `toBeHidden`, `toBeVisible`, `toBeOffscreen`, `toBeInViewport({ ratio, fully })`,
`toReceivePointerEvents`, `toHaveBounds` and `toHaveSpatialRelation`.
An omitted viewport ratio means “any non-zero intersection”; an explicit
`ratio` is an inclusive minimum from `0` through `1`.
Spatial assertions additionally require both locators to come from the same
session, observation revision and known coordinate space.

## Framework capability matrix

This table mirrors `FRAMEWORK_OBSERVATION_CAPABILITIES` from
`@termwright/protocol`, the normative machine-readable registry.

| Framework | Identity | Displayed | Intended rect | Visible rect | Exact hit test | Why |
| --- | --- | --- | --- | --- | --- | --- |
| Generic grid | none | supported | supported | supported | conditional | Grid matches are physical cells; pointer delivery still requires terminal mouse mode. |
| Textual | stable | supported | supported | supported | supported | The compositor exposes intended/clipped regions and Screen.get_widget_at(), the same fresh-pointer routing lookup. |
| OpenTUI | stable | supported | supported | unsupported | supported | The committed native hit grid proves fresh-pointer ownership; the renderer exposes no per-node visual clip rectangle. |
| Ink | stable | supported | conditional | unsupported | unsupported | Intended bounds are conditional on a viewport-stable live region; Ink exposes neither clipping nor pointer ownership. |
| tview | stable | supported | supported | conditional | unsupported | Primitive rectangles do not identify the recipient after overlap. |
| Ratatui | frame-local | conditional | supported | conditional | unsupported | Render areas are frame-local and buffer writes do not preserve widget ownership. |
| Charm | frame-local | conditional | unsupported | unsupported | unsupported | Bubble Tea hands over a rendered string without attributable widget geometry. |

Textual and OpenTUI v2 probes build an exact, compressed fresh-pointer map from
the same routing lookup the framework uses. Active drag/capture is deliberately
outside that claim. If any framework recipient cannot be mapped to a semantic
node, the whole map becomes unknown; it is never encoded as an empty cell.
Known maps are canonical, non-overlapping row-major runs (`height: 1`, positive
width). Ownership is therefore unambiguous and hostile input is validated in
linear time.
Semantic pointer actions are unavailable in `termwright/1`, including for
hand-written adapters. Exact pointer ownership requires a v2 hit grid.

## Action and assertion matrix

This operation matrix is derived from the same registry. `conditional` means
the operation succeeds only when the runtime publishes the required known
observation (and, for pointer actions, terminal mouse mode is enabled).

| Framework | Keyboard | Pointer | Attached | Detached | Displayed | Hidden | Visible | Offscreen | In viewport | Receives pointer | Bounds | Spatial | Cell snapshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Generic grid | supported | conditional | supported | supported | supported | supported | supported | supported | supported | conditional | supported | supported | supported |
| Textual | supported | conditional | supported | supported | supported | supported | supported | supported | supported | supported | supported | supported | supported |
| OpenTUI | supported | conditional | supported | supported | supported | supported | unsupported | unsupported | unsupported | supported | supported | supported | unsupported |
| Ink | supported | unsupported | supported | supported | supported | supported | unsupported | unsupported | unsupported | unsupported | conditional | conditional | unsupported |
| tview | supported | unsupported | supported | supported | supported | supported | conditional | conditional | conditional | unsupported | supported | supported | conditional |
| Ratatui | supported | unsupported | supported | supported | conditional | conditional | conditional | conditional | conditional | unsupported | supported | supported | conditional |
| Charm | supported | unsupported | supported | supported | conditional | conditional | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported |

`termwright/2` is the default and requires `qualified-observations`; a complete
pointer map also requires `pointer-hit-grid`. `termwright/1` is available only
through explicit `semanticProtocol: 'termwright/1'` compatibility configuration.
The driver echoes the selected major and rejects a snapshot whose `v` does not match. V2 is
full-snapshot-only until qualified delta semantics are negotiated; v1 delta
semantics are unchanged.

`resize()` returns a receipt containing the requested dimensions, before/after
observation stamps and the paired render revision. A missing repaint is a
timeout; it is never swallowed.
