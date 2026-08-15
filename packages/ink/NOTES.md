# @termwright/ink — implementation notes

Findings, deliberate deviations and open threads. Everything here was verified
against **Ink 7.1.1** (React 19.2, Node 22+); the version matters, since several
of these rest on Ink internals.

## Marker PoC — design risk #1, resolved

The design named "Ink marker path unproven" as the highest technical risk. It is
now proven, in-process and in a real child process (`src/real-process.test.ts`):

- **Ink calls `options.onRender` *before* it writes the frame.** In `ink.js`,
  `onRender` invokes the user callback immediately after computing the output
  string and only then writes to stdout. Emitting the marker from inside
  `onRender` would place it in front of its own frame.
- The adapter therefore bumps the revision synchronously and defers the rest by
  one macrotask (`setImmediate`), by which point Ink has queued the entire
  frame — including the closing synchronized-output sequence (`ESC[?2026l`).
- The observed byte order for a revision is:
  `ESC[?2026h … frame … ESC[?2026l` then `ESC P twm;<rev>;<mac> ESC \`.
  The marker sits *outside* the synchronized-output block. If the driver's VT
  layer assumes anything about the marker's position relative to BSU/ESU, that
  is the position.
- Writing the marker through Ink's canvas is impossible (it tokenises and clips
  non-SGR sequences) and `useStdout().write()` is also wrong — it erases and
  redraws the frame around the payload. The adapter writes to the raw stream.

### Why not `waitUntilRenderFlush()`

The task brief specified `onRender` + `waitUntilRenderFlush()`, and the adapter
deliberately uses only the first. `waitUntilRenderFlush()` calls `settleThrottle`
on the pending throttled render before it resolves, so awaiting it can flush a
**newer** frame ahead of the marker and silently pair revision N's tree with
revision N+1's pixels. A zero-length `stdout.write('', callback)` flushes what is
already queued and nothing more, which is exactly the guarantee the marker needs.

## Ink API gaps (upstream PR candidates)

1. **`aria-label` is not retained on the element.** `Box` turns it into a text
   child only when the screen reader is enabled, and `Text` drops it otherwise;
   `DOMElement.internal_accessibility` carries `role` and `state` but no label.
   Accessible names therefore come from `useSemantic({name})` or from rendered
   text. Adding `label` to `internal_accessibility` would make Ink's own aria
   props sufficient — the single most valuable upstream change for us.
2. **No public handle on the root element.** `render()` returns an `Instance`
   with no access to `ink-root`, so the adapter mounts a `display: none` probe
   `<Box>` and reaches the root through `ref.current.parentNode`. A hidden box is
   excluded from Yoga layout and emits no bytes — asserted against an
   uninstrumented baseline in `adapter.test.tsx` and `real-process.test.ts` — but
   an official root accessor or layout-commit hook would remove the trick.
3. **`internal_accessibility` is `internal_`-prefixed yet part of the public
   `DOMElement` type.** The adapter reads it (never writes it). If Ink renames
   it, role detection for un-annotated apps breaks; `useSemantic` keeps working.

## Deliberate design choices

- **Role mapping is conservative.** Ink roles with no unambiguous protocol
  counterpart (`combobox`, `radiogroup`, `tablist`, `toolbar`) become `generic`.
  A bordered `<Box>` is *not* promoted to `region`: a border is styling, not
  semantics. Level 2 of the fallback chain therefore yields little beyond
  `application` and `text` — honest, and it keeps locators from matching the
  wrong node.
- **Only meaningful nodes are published**: annotated elements, elements with Ink
  accessibility props, and text-bearing `ink-text` elements. Plain layout boxes
  would multiply the node count without adding anything addressable.
- **`multiselectable` and `required`** exist in Ink's `aria-state` but not in the
  protocol's closed state set, so they are dropped.
- **Bounds honesty.** `measureElement` is relative to Ink's live layout region.
  The adapter claims `absolute-bounds` only for interactive + `alternateScreen`
  runs, and suppresses `bounds` entirely once a `<Static>` node appears, because
  Static output shifts the region by an amount the process cannot observe.
  Interactivity is resolved conservatively (explicit option, else TTY and no `CI`
  marker) rather than by importing Ink's `is-in-ci` detection.
- **No error class.** CONTRACTS requires cross-boundary errors to be
  `TermwrightError` subclasses; this adapter instead guarantees it never throws
  across its boundary at all — every channel fault degrades to "disabled". That
  is a stronger contract, and it avoids the structural-clone workaround
  `@termwright/trace` needed (adapters may not depend on `@termwright/driver`).
- **Node ids** are `n1`, `n2`, … assigned on first sight and held in a `WeakMap`,
  so they stay stable across revisions for as long as an element is mounted.

## Validator invariants the collector must keep

`validateSnapshot` enforces three rules that are stricter than the design prose,
and all three are satisfied by construction:

- **Parentless nodes must appear in `rootIds`.** The collector emits exactly one
  parentless node — Ink's root, published as `application` — and it is the sole
  entry in `rootIds`.
- **`labelledBy` / `describedBy` must resolve inside the snapshot.** Neither is
  emitted at all; Ink has no relation vocabulary to derive them from.
- **Unknown node properties are rejected, not ignored.** Every field is built
  from the protocol's own `SemanticNode` shape via conditional spreads, so an
  absent value is an absent key rather than an explicit `undefined`.

A fourth rule bites harder than it looks: **no value may be reachable twice in
one snapshot.** `defaultActionsForRole` hands out a single shared frozen array
per role, so two buttons in one tree used to carry the *same* array and
`validateSnapshot` rejected the snapshot with `value is reachable more than once
at $.nodes[N].actions`. The collector now copies (`actions: [...actions]`),
which also covers an author hoisting one `actions` const across many
`useSemantic` calls.

This one hid for a while because **the channel destroys the evidence**:
`encodeFrame` JSON-serialises, and JSON has no aliases, so anything that reaches
the driver — including `get-tree` responses, and including
`@termwright/ink-testing`, whose "in-process" refers to the application process
and not to the channel — always saw a valid snapshot. The exposure is narrower
and more precise than "in-process consumers": **only a caller that reads the
collector's object without a serialisation round-trip in between.** In practice
that is this package's own tests and anything that embeds `SnapshotCollector`
directly.

`collect.test.tsx` therefore runs `validateSnapshot` against a snapshot
collected straight off a mounted tree, with no socket in between. A test that
only inspects what the fake driver received cannot catch this class of bug, no
matter how many same-role nodes it builds — two such nodes are necessary but not
sufficient. Credit to the OpenTUI adapter for hitting it first, and to
`@termwright/ink-testing` for correcting the blast radius.

The subtle case is truncation: when the walk stops at `maxNodes`, children are
never emitted after their parent was dropped, because `parentId` always points
at the nearest *published* ancestor and ancestors are pushed first.
`collect.test.tsx` asserts the relation invariants for both a full tree and a
truncated one, and the fake driver runs `parseAdapterMessage` over every frame,
so the whole suite exercises real validation rather than a mock of it.

## Gotchas for future maintainers

- **`rerender` must re-apply the provider.** `Instance.rerender` replaces the
  entire root; the returned instance wraps it so the `SemanticProvider` survives.
  Without that the probe ref detaches on the second frame and the session goes
  quiet with no error anywhere — it cost an afternoon once already.
- `ADAPTER_VERSION` in `src/render.tsx` duplicates `package.json`. Bump both.
- Tests that need JSX are `*.test.tsx`, next to their sources; CONTRACTS says
  `*.test.ts`, and this is the only reason for the extension.
- `src/testing/` holds test-only support (fake driver, fake stdout, marker
  extraction, the child-process fixture). It is not exported from `src/index.ts`
  and never ships — `tsup` bundles from the entry point only.
- `src/real-process.test.ts` builds `dist/` on demand when it is missing or
  stale, so it can run standalone; the DoD sequence builds first anyway.

## Open threads

- No `cursor` in snapshots. Ink has `useCursor`/`setCursorPosition` but exposes
  no way to read the committed cursor position from outside a component; the
  protocol field stays absent until it does.
- `text-ranges` and `tree-diffs` capabilities are not claimed. Both are additive
  in v1.x and neither is needed for the first driver.
- Windows named pipes are handled by `node:net` transparently, but nothing in
  this package has been exercised on Windows yet.
