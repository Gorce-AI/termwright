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

## Ink API gaps (permanent — no upstream PR is coming)

1. **`aria-label` is not retained on the element.** `Box` turns it into a text
   child only when the screen reader is enabled, and `Text` drops it otherwise;
   `DOMElement.internal_accessibility` carries `role` and `state` but no label.
   Accessible names therefore come from `useSemantic({name})` or from rendered
   text. Adding `label` to `internal_accessibility` would make Ink's own aria
   props sufficient, and it remains the single most valuable change Ink could
   make. We are not proposing it: the integration has to stand on its own
   indefinitely, so this is a constraint to live with, not a ticket to file.
2. **No public handle on the root element.** `render()` returns an `Instance`
   with no access to `ink-root`, so the adapter mounts a `display: none` probe
   `<Box>` and reaches the root through `ref.current.parentNode`. A hidden box is
   excluded from Yoga layout and emits no bytes — asserted against an
   uninstrumented baseline in `adapter.test.tsx` and `real-process.test.ts`. An
   official root accessor or layout-commit hook would remove the trick; absent
   one, `invisibility.test.tsx` pins exactly what the trick costs.
3. **`internal_accessibility` is `internal_`-prefixed yet part of the public
   `DOMElement` type.** The adapter reads it (never writes it). If Ink renames
   it, role detection for un-annotated apps breaks; `useSemantic` keeps working.

## `<Semantic>`: annotate the child's element, never render one

The declarative wrapper must not introduce a `<Box>`. In a terminal a layout
change *is* a visible change, so a wrapper element would break the byte
identity the whole adapter rests on. `<Semantic>` therefore clones its single
child with a ref attached and renders nothing of its own — zero nodes, zero
layout, zero bytes, asserted against a plain baseline in both
`semantic.test.tsx` and `invisibility.test.tsx`.

Consequences worth knowing:

- **The child must accept a ref, which in Ink means `<Box>`.** `<Text>` is a
  plain function component; in React 19 the ref simply arrives as an ignored
  prop, so a `<Semantic>` wrapped around bare text annotates nothing. It still
  *renders* the text — throwing would violate the rule that this adapter never
  takes an application down — and it stays silent, because a `console.warn`
  would violate the invisibility guarantee proven next door. Documented in the
  README instead.
- **Refs compose.** If the application already put a ref on that element, both
  are called; the annotation never steals it.
- **Nesting needs no context.** The collector derives `parentId` from the
  rendered tree, so a `listitem` inside a `list` is already published under it.
  The brief asked for a context to carry `parentId`; it would have been dead
  code, and the nesting tests pass without it. The one case a context *would*
  disambiguate is two `<Semantic>` wrappers around the same element, where the
  registry is keyed by element and the outer one wins — rare enough to
  document rather than engineer around.

The invisibility claim was verified by sabotage: replacing the clone with a
real `<Box>` wrapper turns three tests red, byte identity among them.

## Invisibility to the host application — what is proven, and what it costs

Since no upstream change is coming, the way this adapter hooks in has to stay
invisible to application authors indefinitely. `invisibility.test.tsx` and the
real-process suite turn that from a claim into a check. Proven, under
instrumentation, against a plain `ink.render` baseline:

- **React emits nothing.** Not one line on `console.error/warn/log/info/debug`
  across mount, re-render and unmount — including under `<StrictMode>`, which
  double-invokes renders and effects.
- **The application's own view of itself is identical**: same `nodeName`, same
  child count, same parent, same `measureElement` result, and the same number
  of effect runs. Annotated and un-annotated trees alike.
- **Nothing happens after unmount**: no further snapshot reaches the driver and
  no further marker reaches stdout, including when a re-render lands in the
  same tick as the unmount.
- **Dormant output stays byte-identical under `<StrictMode>`**, and under
  instrumentation the stream differs from the baseline by the marker sequences
  and nothing else.

### The one difference, stated plainly

The `display: none` probe adds **exactly one** child to `ink-root`. It is
zero-sized, excluded from Yoga layout, and contributes no bytes — but an
application that walks `ref.current.parentNode` up to the root and enumerates
`childNodes` will see it. Nothing in Ink's public API hands out the root, so
this is close to unobservable in practice; it is asserted rather than described,
so if it ever grows into something bigger a test fails.

### React DevTools

A DevTools hook merely present in globals is **never touched**: Ink registers a
renderer only when `DEV=true` *and* a DevTools server answers on port 8097
(`ink/build/ink.js` gates the import; `devtools.js` probes the socket). The
real-process fixture installs a hook stub and exits non-zero if anything calls
into it, so the assertion is "nothing registered behind the application's back"
rather than the weaker "no crash". Unrelated but worth knowing when reading a
bug report: with `DEV=true` and no server running, **Ink itself** prints a
`console.warn` telling you to start `npx react-devtools`. That line is Ink's,
not ours.

### A note on the method

The console trap was itself verified against a real React warning (a list
rendered without `key` props) before being trusted. A silence assertion whose
trap cannot catch anything proves nothing — the same failure mode that hid the
`actions` aliasing bug, where the assertion ran on data the channel had already
sanitised.

## Ink's `patchConsole` cannot be hooked (and would not be enough)

The brief asked for console output to become log records by hooking Ink's
`patchConsole`. That is not possible with public API, and the internals would
not carry what we need anyway — both halves matter, so here is what Ink 7.1.1
actually does:

- `Ink.patchConsole()` calls the `patch-console` package with a private
  callback and keeps the restore function on the instance. Neither the callback
  nor a way to register one is exposed on `RenderOptions` or `Instance`.
- Even with access, **the level is already gone**. `patch-console` builds an
  internal `console.Console(stdout, stderr)` over two `PassThrough` streams, so
  Ink's callback receives `(stream, data)` where `stream` is only `'stdout'` or
  `'stderr'` and `data` is preformatted text. `console.warn` and `console.error`
  are indistinguishable at that point, and so are `log`, `info` and `debug`.

So the adapter wraps the console methods itself (`captureConsole` in
`src/logs.ts`), which is plain JavaScript rather than an Ink internal. Two
details make it compose with Ink instead of fighting it:

- the wrapper is installed **after** the first render and only once the driver
  has actually enabled logs, so it wraps Ink's already-patched methods; the
  original call still reaches Ink's render-safe routing, and the frame is never
  corrupted. Wrapping earlier would mutate a global for records that no
  subscriber would receive;
- Ink restores the pristine console on unmount, which drops our wrapper with
  it, so there is nothing to leak.

Records are tagged `logger: 'console'` so a test can tell them apart from an
application's structured logging — which matters for apps whose logger also
prints, where the same event legitimately arrives twice by two routes. That is
also why `semantics.captureConsole: false` exists.

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
- **The log budget is enforced at the source.** A token bucket sized by
  `hello-ack.logs` (`maxRecordsPerSecond` refill, `burst` capacity) drops
  over-budget records before they reach the socket, because a log storm that
  got that far would compete with the semantic tree for the frame budget.
- **The adapter owns wire `seq`** (contract change of 2026-08-16).
  `termwright:log` is a public channel, so two independent publishers can each
  emit `seq: 7` in good faith while the wire requires strict increase; records
  are therefore renumbered in send order. The counter is consumed **before**
  the budget check, so a dropped record still burns its number and an upward
  gap keeps meaning "dropped at the source" rather than "never seen". Note
  that a trailing drop stays invisible until a later record lands — the test
  asserts the gap only after publishing again past the refill.
  The publisher's own number survives as the `origin.seq` attribute, which
  makes a duplicated publisher diagnosable, but it is dropped rather than
  allowed to push the record past `MAX_LOG_ATTRS` or `maxLogRecordBytes`:
  turning a log line into a malformed frame is worse than losing a hint.
- **`logs` is announced whenever the process is instrumented**, because the
  diagnostics channel is always a possible source: any dependency can publish
  to `termwright:log` without importing anything of ours. Whether records
  actually flow is the driver's decision, taken in `hello-ack`.
- **A record is stamped with the current revision** when the publisher did not
  set one, which is accurate because forwarding is synchronous with
  publication. The stamp builds a fresh object rather than mutating the frozen
  record — the same aliasing discipline as `actions`.

## Tree deltas: the cascade is the whole difficulty

Under `subscribe: 'diffs'` the adapter diffs each snapshot against **the last
tree it actually sent**, not against the previous revision — a superseded
render never reaches the driver, so its tree is not a base anything can
compose onto.

The delta format removes an id together with its subtree, walking the **base**
tree's parent links. That is what keeps deltas small, and it is also the one
rule a naive diff gets wrong:

> A node that survived the re-render, is byte-identical, and happens to sit
> under something that disappeared **is deleted by the cascade** and must be
> re-listed in `changed` anyway.

`computeTreeDelta` therefore emits three kinds of upsert: new nodes, changed
nodes, and unchanged nodes caught in the collateral of a removal. Removals list
only the top of each removed subtree.

The first publication always goes out as a full snapshot (a delta needs a base),
and so does any delta that grew past half the snapshot's encoded size —
`subscribe: 'diffs'` expresses a preference, not a prohibition, and past that
point a delta costs the same bytes plus composition work. `get-tree` is always
answered with a full snapshot. Message order on the session is unchanged:
`(delta|snapshot)` → `revision-commit` → marker.

### What the tests are worth

`applyTreeDelta` from the protocol is used as an oracle: base + delta must
reproduce the adapter's own snapshot exactly. Two rounds of deliberate
sabotage were needed before that suite was worth anything:

- the first version of the sequence test counted tree messages from zero while
  the opening snapshot had already arrived, so every wait was satisfied
  immediately and **no delta was ever exercised**. A `deltas.length > 0` guard
  now makes that failure loud;
- the first "cascade trap" test moved the surviving node to a new parent, which
  the ordinary "differs" check already catches — it passed with the cascade
  rule deleted. It now uses a node that is byte-identical in both trees and
  dies only because its *grandparent* was removed.

Each of the three plausible mistakes — dropping the resurrection, listing every
removed id instead of subtree roots, never sending `rootIds` — is now caught by
exactly one test, verified by making each break in turn.

## Naming: containers are not named from content

The protocol's naming rules gate descendant-text naming to nine roles
(`button`, `listitem`, `menuitem`, `tab`, `checkbox`, `radio`, `cell`, `row`,
`heading`). This adapter used to name *every* role from concatenated descendant
text, which is the bug the rule exists to prevent: with it,
`getByRole('region', {name: 'Approve'})` matches the dialog *containing* the
Approve button, and every ancestor of a label becomes a plausible match.

`text` is treated as a tenth name-from-content role — an `ink-text` element's
string is its own content, not a descendant widget's — and that reading is
declared in the README's Deviations rather than left implicit.

One existing test encoded the old behaviour (a `progressbar` named "working"
from its child text) and now asserts the empty name instead. That is the
intended break: a progressbar's name is a label, and its content is its value.

## Focus is readable, but not attributable

Worth recording because the first answer looks like "no": Ink *does* expose the
active focusable publicly, via `useFocusManager().activeId`, and the provider
reads it on every commit. What Ink never exposes is **which element** that id
belongs to — `useFocus` ids are `Math.random()` unless the author passes one,
and the hook returns `isFocused` only to the component that called it.

Calling `useFocus` from the adapter is not an option either: it *registers* a
focusable and would change the application's Tab order, which the invisibility
guarantee forbids.

So `focusId` on the annotation is the bridge: the author names the id they
already gave `useFocus`, and the adapter compares it with `activeId`. That
satisfies the "read from a native flag, never inferred" rule — without it,
`focused` stays absent, which is the honest report.

`useFocusManager` only reads context, unlike `useFocus`; the invisibility suite
(effect-run parity against a plain baseline) is what keeps that claim honest.

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
