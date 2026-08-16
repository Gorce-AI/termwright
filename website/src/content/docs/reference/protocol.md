---
title: Protocol v1
description: The semantic wire protocol — transport, handshake, framing, the render marker, the data model and its ceilings.
---

The protocol is language-neutral, and `@termwright/protocol` is its normative
implementation: where a client differs from it, the client is wrong. Everything
here **fails closed** — untrusted input is rejected with a typed violation, never
partially accepted.

## Transport and lifecycle

The driver creates a private endpoint **before** it spawns the child: a unix
socket in a `0700` temporary directory on macOS and Linux, or a named pipe with
an unguessable name on Windows. Never TCP.

Three variables are injected into the child:

| Variable | Meaning |
|---|---|
| `TERMWRIGHT_ENDPOINT` | the socket or pipe path |
| `TERMWRIGHT_TOKEN` | 256 bits of randomness, opaque |
| `TERMWRIGHT_PROTOCOL` | `1` |

Without them an adapter is [dormant](../../adapters/writing-an-adapter/): it
opens nothing and the run is byte-identical to an uninstrumented one.

The handshake is a bounded `hello` carrying the token, the protocol version, the
adapter identity and a capability list. The driver replies with the selected
version, session limits and marker configuration. No valid hello inside the
negotiation window (250 ms by default) means `semanticTree: false` and a
generic session; a late or malformed hello never flips an already-selected mode.

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
ESC P t wm;{revision};{mac} ESC \
```

The MAC is `base64url(HMAC-SHA256(token, "{sessionId}:{revision}"))` truncated to
16 bytes. Comparison is constant-time; revisions must be canonical decimal (`01`
is not `1`); and the MAC binds both session and revision, so it cannot be
replayed across either.

A private DCS sequence is used rather than APC because xterm.js does not support
APC, and a registered DCS handler removes the sequence from the visible grid.

:::caution[The trap when integrating with a VT parser]
Parsers dispatch on the DCS **final byte** and consume it, so a handler
registered on `{final: 't'}` receives only `wm;{rev};{mac}`. Verification
expects the payload *including* the final byte — prepend it, or every marker
silently fails to verify.
:::

```ts
import {MARKER_DCS_FINAL, verifyMarkerPayload} from '@termwright/protocol';

term.parser.registerDcsHandler({final: MARKER_DCS_FINAL}, (data) => {
  const marker = verifyMarkerPayload(MARKER_DCS_FINAL + data, token, sessionId);
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
and optionally a `cursor` (position, visibility, shape). A node carries an id, an
optional `parentId`, a role, a name, states, action hints, an optional `testId`
and optional `bounds`.

Validation enforces: unique ids, parents that exist, acyclic parent chains,
depth / count / byte ceilings, UTF-8 byte bounds on strings, safe-integer rects
that intersect the viewport unless the node is hidden, a positive revision, and
a closed role and action set. Unknown properties are rejected, not ignored, and
checks run cheapest-first so an oversized snapshot is rejected before any
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
Consumers treat it as a normal state and fall back to their non-geometric path;
only hit-testing genuinely needs geometry.

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
