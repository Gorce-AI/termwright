# @termwright/opentui — implementation notes

Everything here was verified against **`@opentui/core` 0.5.3** on macOS
(darwin-arm64), Bun 1.2.15 and Node 24. Several points rest on OpenTUI
internals, so the version matters.

## The research brief vs. the shipped API

The design doc (§7) described OpenTUI as offering "cached `screenX/screenY`,
parent chain, `getChildren()`, lifecycle hooks and `layout-changed`", with the
role convention going in "via reconciler props". Three of those held; two did
not, and both changed the design.

### 1. Bun-only runtime — the blocker worth knowing about

`@opentui/core` loads its native Zig library through a small FFI shim that picks
a backend at import time: `bun:ffi` under Bun, otherwise `require('node:ffi')`.
`node:ffi` does not exist in any released Node (24 rejects it as an unknown
built-in, and there is no flag), so under Node the shim installs an
"unsupported" backend and `createCliRenderer` throws:

```
Error: Failed to initialize OpenTUI render library:
OpenTUI native FFI is not available for this runtime yet
```

**Consequences, all of them deliberate:**

- The adapter itself is plain ESM over `node:net` and runs anywhere. It is only
  the *host application* that needs Bun.
- The unit suite never constructs a real renderer. It runs against
  `src/testing/fake-renderer.ts`, which reproduces the three behaviours the
  adapter depends on and nothing else.
- The claim that a real renderer matches the structural view is checked by the
  type checker, in `opentui-types.test.ts`, against the installed
  `@opentui/core`. If OpenTUI renames `screenX` or drops `getChildren`,
  `pnpm typecheck` fails there rather than a user's build failing later.
- Behaviour is checked by `src/conformance.test.ts`, which runs a real OpenTUI
  app under `bun` in a real pty. It skips with a reason when `bun` is absent or
  `dist/` has not been built — the right default on a developer machine.
  **CI must install Bun and set `TERMWRIGHT_REQUIRE_CONFORMANCE=1`**, which
  turns those skips into failures: a lane whose whole purpose is this suite
  must not go green having run none of it. The `opentui` job in
  `.github/workflows/ci.yml` installs Bun and builds first.

When OpenTUI ships a Node backend (or Node ships `node:ffi`), nothing in this
package changes — the conformance test simply stops needing the `bun` binary.

### 2. `frame` fires *after* the bytes, which makes the marker trivial

The brief suggested `layout-changed` / `renderAfter` as the commit hook. Neither
is right: `layout-changed` fires during layout, before anything is drawn, and
`renderAfter` is a per-renderable draw callback into a buffer, not a frame
boundary.

The right hook is `CliRenderEvents.FRAME`. In the render loop, `emit('frame')`
comes *after* `renderNative()` has written the frame out, and it is emitted only
when the native status is `rendered`. So the adapter can collect and mark
synchronously, with no deferral at all — the opposite of the Ink adapter, which
has to defer past a macrotask because Ink calls `onRender` *before* it writes.

Observed order, asserted in `adapter.test.ts` and again by the conformance
suite: `…frame bytes… ESC[?2026l` then `ESC P twm;<rev>;<mac> ESC \`. The
marker sits outside the synchronized-output block, the same position the Ink
adapter produces.

`renderer.idle()` exists and is a genuine settle primitive; the adapter does not
need it, but a harness built on this adapter will.

### 3. Frames are on-demand, not free-running

Without `renderer.start()`, OpenTUI renders when something requests it: a
mutation produces exactly one frame. With `start()` the loop runs at `targetFps`
and `frame` fires per iteration. The adapter treats every `frame` as a
revision, so an application that calls `start()` will publish revisions at its
frame rate. That is correct — each one really is a committed frame — but it is
worth knowing before wondering why revisions climb while the screen is still.

### 4. Unknown construction options are dropped

`new BoxRenderable(renderer, { role: 'button' })` does **not** leave `role` on
the instance; OpenTUI reads the options it knows and discards the rest. So the
"role convention via reconciler props" from the brief cannot work as written —
a prop passed through `@opentui/react` would be dropped the same way.

Hence two supported forms: `describeRenderable(node, meta)` (primary, weakly
held, the equivalent of Ink's `useSemantic`), and convention properties
assigned *after* construction (`node.role = 'button'`), which is what a
reconciler `ref` callback can do. Both are documented in the README.

## Deliberate design choices

- **Node ids are `n<num>`**, from OpenTUI's own per-instance counter. Identity
  is therefore free — no `WeakMap`, no id assignment pass — and two widgets can
  never collide. The Ink adapter needs a `WeakMap` because Ink's DOM nodes carry
  no such number.
- **Bounds honesty.** `screenX`/`screenY` are renderer coordinates, not terminal
  coordinates. They coincide only in `alternate-screen` mode, which is the only
  mode where `absolute-bounds` is claimed and the only mode where `bounds` are
  published at all.
- **`SelectRenderable` maps to `list`, with no synthetic children.** Its options
  are data the widget draws itself, not renderables, so there is no honest way
  to give each option bounds. Publishing option nodes without bounds would put
  un-clickable items in the tree. The selected option's name becomes the list's
  name instead. An open thread, below.
- **`disabled` comes from a convention property.** OpenTUI has no disabled
  concept; an application that has one says so, and the adapter does not invent
  it from `focusable: false`.
- **No error class.** CONTRACTS requires cross-boundary errors to be
  `TermwrightError` subclasses; this adapter instead guarantees it never throws
  across its boundary at all — every channel fault degrades to "disabled". Same
  reasoning as the Ink adapter.

## Why the mount lives on a subpath

`mountOpenTui` needs `@termwright/driver` (for `launchTerminal` and the harness
type) and `@termwright/ink-testing` (for the in-process pty stand-in). CONTRACTS
§Dependency rules says adapters depend on `protocol` + their framework and
**never** on the driver, and that rule has a concrete reason rather than a
bureaucratic one: an adapter is imported by the application in *production*, and
the driver carries a pty binary. Ink solved the same problem by putting
`mountInk` in a separate package, `@termwright/ink-testing`.

Task #27b asked for the mount inside `packages/opentui`, so the rule is honoured
structurally instead of by package boundary:

- the mount is reachable only through `@termwright/opentui/testing`, never from
  the root entry;
- `@termwright/driver` and `@termwright/ink-testing` are **optional peer**
  dependencies, so a production install of the adapter resolves neither;
- `mount.test.ts` asserts against the build output that `dist/index.js` contains
  no reference to either. If someone re-exports the mount from `src/index.ts`,
  that test fails rather than a user's bundle quietly gaining a pty.

Recorded in CHANGELOG-contracts.md. If a second consumer ever needs the mount's
dependencies at the root, the honest move is a separate
`@termwright/opentui-testing` package, mirroring Ink.

## Building the renderer synchronously

`createInProcessBackend`'s `start` is synchronous — the driver spawns and the
backend must hand back a live application in the same tick — but
`createCliRenderer` is async. The mount therefore uses the **`CliRenderer`
constructor**, which is public and does all the stream wiring, and runs the part
that actually awaits (`setupTerminal()`, then instrumenting, then building the
scene) as a promise the `stop()` path joins. OpenTUI's own factory is documented
as "constructor + `await setupTerminal()`" plus a `--delay-start` flag, so this
is the supported decomposition rather than a workaround.

A scene that throws is remembered and rethrown in preference to the settle
timeout it would otherwise surface as, because "your builder threw" is the
useful failure and "no frame in 5s" is only its symptom.

## The duplicated channel client

`src/channel.ts` is, deliberately, a near-copy of the Ink adapter's. Adapters
may not depend on each other (CONTRACTS §Dependency rules) and may not depend on
the driver, and the shared thing between them — the wire format — already lives
in `@termwright/protocol`, which both import. What is duplicated is ~200 lines
of socket lifecycle, not a contract. If a third TypeScript adapter appears, a
`@termwright/adapter-kit` package holding this file is the move; two is not
enough to justify a package.

## A bug this package found in a shared assumption

`validateSnapshot` rejects a snapshot in which any value is reachable twice
(`projectDto`: "value is reachable more than once at $.nodes[2].actions"). The
role table hands out one frozen array per role, so two buttons in one tree
shared their `actions` array and the snapshot failed validation.

The collector copies the array per node now. **`@termwright/ink` has the same
shape and, as far as this package can tell, the same latent bug** — its own
tests never put two same-role nodes in one snapshot. Worth a look from that
package's owner.

## Gotchas for future maintainers

- `ADAPTER_VERSION` in `src/instrument.ts` duplicates `package.json`. Bump both.
- `src/testing/` is test-only support (fake driver, fake renderer, marker
  extraction, the conformance fixture). It is not exported from `src/index.ts`
  and never ships — `tsup` bundles from the entry point only.
- The conformance fixture imports `../../dist/index.js` on purpose, so a stale
  build fails the suite instead of hiding behind the sources.
- The fixture writes its status text into *blank* cells rather than relabelling
  in place. OpenTUI repaints only changed cells, so relabelling `Ready` to
  `[Save]` emits `[S` and `ve]` around the unchanged `a`, and the word never
  appears contiguously in the byte stream a text matcher sees. This cost an
  hour; the fixture's header says so too.

## Open threads

- **`Select` and `TabSelect` options are not individually addressable.** Giving
  them bounds means reproducing the widget's own scroll and row arithmetic,
  which would go stale with every OpenTUI release. The honest fix is upstream:
  an accessor that reports the drawn rectangle of an option.
- **No `cursor` in snapshots.** `renderer.getCursorState()` exists and looks
  usable; it was left out of v1 rather than shipped unverified.
- **`text-ranges` and `tree-diffs` capabilities are not claimed.** Both are
  additive in v1.x and neither is needed by the first driver.
- **`CliRenderer.stdout` is read as a private field** when the caller does not
  pass `stdout` explicitly. A public accessor for the stream a renderer draws
  into would remove the reach-in; it is the one upstream request this adapter
  would file.
- Nothing here has been exercised on Windows.
