---
title: Protocol v1 and v2
description: The semantic wire protocol — transport, handshake, framing, the render marker, the data model and its ceilings.
---

The protocol is language-neutral, and `@termwright/protocol` is its normative
implementation: where a client differs from it, the client is wrong. Everything
here **fails closed** — untrusted input is rejected with a typed violation, never
partially accepted.

## Protocol majors

`termwright/2` is the default protocol. `termwright/1` is available only through
an explicit compatibility option for existing adapters. Its optional
`bounds` field is a legacy, unqualified projection; paint-order knowledge is
not pointer ownership.

`termwright/2` requires `qualified-observations` and snapshot `v: 2`. Nodes
carry separate evidence-qualified `displayed`, `intendedRect` and `visibleRect`
facts. The snapshot carries its coordinate space and an explicit `hitGrid`
observation. A known grid additionally requires `pointer-hit-grid`. The driver
echoes the selected major and rejects mixed-major traffic. See
[Geometry, visibility and pointer ownership](../geometry-visibility/).

## Transport and lifecycle

The driver creates a private endpoint **before** it spawns the child: a unix
socket in a `0700` temporary directory on macOS and Linux, or a named pipe with
an unguessable name on Windows. Never TCP.

Three variables are injected into the child:

| Variable | Meaning |
|---|---|
| `TERMWRIGHT_ENDPOINT` | the socket or pipe path |
| `TERMWRIGHT_TOKEN` | 256 bits of randomness, opaque |
| `TERMWRIGHT_PROTOCOL` | `termwright/2` by default; `termwright/1` only for an explicit compatibility session |

Without them an adapter is [dormant](../../adapters/writing-an-adapter/): it
opens nothing and the run is byte-identical to an uninstrumented one.

The handshake is a bounded `hello` carrying the token, the protocol version, the
producer identity and an adapter capability list. A framework probe additionally
sends `probe {framework, frameworkVersion?, probeVersion, identityKind,
capabilities}`. Adapter capabilities describe wire traffic such as trees,
bounds, diffs and logs; probe capabilities describe observable framework facts
such as stable identity, visible rectangles, annotations and paint order. The
driver replies with the selected version, session limits and marker
configuration. No valid hello inside the negotiation window (250 ms by default)
means `semanticTree: false` and a generic session; a late or malformed hello
never flips an already-selected mode.

## Framing

A 4-byte big-endian length prefix followed by UTF-8 JSON. The declared length is
checked against the ceiling **before** any body is read, so a four-byte header
claiming 4 GB costs four bytes. Partial frames are buffered and never emitted; a
violation poisons the decoder permanently rather than resynchronising on an
attacker-chosen offset.

Every decoded value is projected into an immutable plain DTO. The projection
walks the graph with property descriptors and rejects accessors, proxies, symbol
keys, exotic prototypes, reserved keys such as `__proto__`, sparse arrays,
aliases and cycles, non-finite numbers, and unpaired surrogates. **A getter on
hostile input is detected without being invoked.** The result is a deep-frozen
copy sharing no references with the input.

## Message model

Three kinds of traffic on one channel, CDP-style:

1. **adapter push** — `revision-commit {revision}` after each committed render,
   and optionally changed subtrees once the diff capability is negotiated;
2. **driver request/response** — `getTree {revision?}`, `getNode {id}`;
3. **subscriptions** — the driver declares whether it wants full snapshots,
   diffs, or bare revision numbers.

Full snapshots after each commit are the baseline. Deltas are negotiated, and
every delta binds an exact base revision — any gap forces a full rehydrate.

## Tree deltas

An adapter that announces the `tree-diffs` capability can subscribe the driver
to `tree-delta` messages instead of a full snapshot after each commit. A
semantic tree changes on nearly every keystroke, and resending all of it each
time is what makes the semantic channel expensive — so **an adapter that offers
deltas gets them by default**.

```ts
import {applyTreeDelta, validateTreeDelta} from '@termwright/protocol';

const checked = validateTreeDelta(body, limits);        // shape only
if (!checked.ok) return closeWith('malformed', checked.detail);

const composed = applyTreeDelta(held, checked.delta, limits);
if (!composed.ok) {
  // Never patch around a mismatch — ask for the whole tree instead.
  if (composed.code === 'revision') return requestFullTree();
  return closeWith('malformed', composed.detail);
}
```

### Composition rules

Normative — every adapter and every client must agree on all four, or two
implementations will hold different trees while both believe they are correct:

1. **`changed` upserts by id, replacing a node wholesale.** Never field-merged:
   merging would need a third state meaning "unset this optional field", which
   the wire cannot express.
2. **`removed` removes each id together with its subtree.** The cascade is what
   keeps deltas small — dropping a dialog is one id, not one per descendant —
   and it is the only rule that cannot leave orphans behind.
3. **`rootIds`, when present, replaces the root list.** When absent, the base
   roots carry over minus anything removed. So *introducing a new root requires
   sending `rootIds`*; otherwise the parentless node is missing from the root
   list and validation rejects it.
4. **Removals apply before upserts**, so a single delta can rescue a node out of
   a subtree it also removes.

`cursor`, when present, replaces the cursor; absent means **unchanged**. Without
that rule a diffs-only session could never move the cursor — which in a TUI
moves on nearly every keystroke — making the mode useless for exactly the
interactive applications it exists to make cheap.

:::caution[A delta can set the cursor but cannot clear it]
`{visible: false}` means there is a cursor and it is hidden. An absent `cursor`
on a snapshot means there is no cursor information at all. Those differ, so a
producer whose tree loses its cursor entirely **must send a full snapshot**.
:::

### When a delta cannot be composed

The driver asks for a full tree (`get-tree`) and ignores further deltas until it
arrives. That is reported as **`delta-resync`**, not as a dropped revision:
nothing was lost, and a repair should not read like damage. The last good tree
stays observable throughout.

If you suspect deltas are involved in a bug, take them out of the picture:

```ts
await terminal.launch({command, treeUpdates: 'snapshots'});
```

That declines deltas from an adapter that offers them, so the session behaves
exactly as it did before deltas existed. It is the switch to reach for when a
replay and a live session disagree and the delta path is a suspect.

## The render marker

The stdout marker is a **frame commit, not a data channel**. The adapter emits
it after the last byte of the render for revision N, and its payload is N plus a
MAC, so ordinary program output cannot forge one.

```
ESC ] 8487 ; twm;{revision};{mac} BEL
```

The MAC is `base64url(HMAC-SHA256(token, "{sessionId}:{revision}"))` truncated to
16 bytes. Comparison is constant-time; revisions must be canonical decimal (`01`
is not `1`); and the MAC binds both session and revision, so it cannot be
replayed across either.

A private OSC number is used because a cross-platform PTY probe found ConPTY
drops DCS, APC and OSC 8 while forwarding private OSC and OSC 133. One encoding
is used on every platform. BEL is the emitted terminator because it was the most
reliable form in that probe; parsers may still pass a trailing BEL or ST to the
verifier.

:::caution[The trap when integrating with a VT parser]
Register an OSC handler for code `8487`. The parser consumes the OSC number and
separator; pass the remaining `twm;{revision};{mac}` payload directly to the
verifier. Registering the removed DCS handler or prepending a DCS final byte
makes every current marker disappear.
:::

```ts
import {MARKER_OSC_CODE, verifyMarkerPayload} from '@termwright/protocol';

term.parser.registerOscHandler(MARKER_OSC_CODE, (data) => {
  const marker = verifyMarkerPayload(data, token, sessionId);
  if (marker !== null) commit(marker.revision);
  return true; // consumed: keeps the sequence out of the visible grid
});
```

The driver publishes revision N only when it holds **both** the tree for N and
the grid state at marker N. Waits are bounded in both directions; superseded
incomplete revisions are dropped with a diagnostic; on process exit the last
fully paired revision is published.

## The data model

A snapshot carries a session id, a revision, the viewport, `rootIds`, the nodes,
and optionally a `cursor` (position, visibility, shape). A node carries an id,
an optional `parentId`, role and name, plus optional description, value,
portable `state`, application-owned JSON `extended` state, action hints,
`labelledBy` / `describedBy` relationships, text ranges, `testId` and `bounds`.
An unrecognised widget survives as `role: 'generic'` and must carry its native
`frameworkType` rather than disappearing from the tree.

`p` records the node's primary provenance and `px` records per-field
exceptions. Both use the closed set `annotation | recognizer | framework |
correlation | heuristic`. Legacy v1 `occlusion: known` means only that paint
order was observable. It does **not** identify the topmost input recipient and
cannot vouch for pointer targeting. Bounds without `absolute-bounds` may still
be useful for inspection, but the driver never treats them as terminal cell
addresses. New consumers use the qualified observations described in
[Geometry, visibility and pointer ownership](../geometry-visibility/).

Validation enforces: unique ids, parents that exist, acyclic parent chains,
depth / count / byte ceilings, UTF-8 byte bounds on strings, safe-integer rects
that intersect the viewport unless the node is hidden, a positive revision, and
a closed role, action, state and provenance vocabulary. It also bounds extended
JSON and relationship targets. Unknown properties are rejected, not ignored,
and checks run cheapest-first so an oversized snapshot is rejected before any
per-node work.

Two invariants are stricter than the prose spec and every adapter must satisfy
them: **every node without a `parentId` must appear in `rootIds`**, and
**`labelledBy` / `describedBy` must reference nodes present in the same
snapshot**.

### `bounds` is optional

By design, from day one. Class-B and class-C frameworks publish role-and-name
nodes without trustworthy coordinates, and even a class-A adapter drops bounds
wholesale when it cannot observe its own offset — Ink does exactly that when the
tree contains `<Static>`. **A snapshot carrying no bounds at all is valid.**
Consumers can still use non-geometric APIs such as attachment, text, and
keyboard input; geometric APIs remain unavailable. A pointer action additionally needs
the producer's `absolute-bounds` capability and proof of the exact recipient;
paint-order knowledge alone is insufficient. Keyboard locators remain
available when either fact is absent.

### Roles

The role set is closed and ARIA-aligned, which keeps a future AccessKit / AT-SPI
bridge possible. Resolution is a three-level fallback, normative for all
adapters: an explicit author annotation, then the framework's widget-type map,
then `generic`.

## Ceilings

Absolute limits on tree depth, node count, byte size, frame size, in-flight
frames, waiters and sessions; flood eviction with an explicit retained floor;
typed outcomes for disconnect, crash, partial, duplicate and mismatch; and
exactly-once settlement for every waiter. Token values are redacted from every
diagnostic and never echoed.

Hostile-input suites run under `node --max-old-space-size=128`, so a
resource-exhaustion case fails closed instead of passing by virtue of a large
default heap.

## Cross-language vectors

`clients/test-vectors/` holds fixtures generated from the reference
implementation — exact frame bytes per message, byte-at-a-time decoding, hostile
frames with their violation codes, marker sequences byte for byte including a
non-ASCII token, forgeries that must not verify, and valid and invalid trees
with their validation codes.

The generator re-runs every expectation through the reference implementation
before writing, so a stale or hand-edited vector fails at generation time.

## Versioning

The protocol version is negotiated in the handshake and every language client is
bound to it. Additive changes (new capabilities, diffs, new optional fields)
land in 1.x; anything that would invalidate an existing adapter's frames is a
version bump, not a patch.
