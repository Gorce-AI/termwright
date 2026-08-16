# @termwright/protocol

The termwright semantic wire protocol: message shapes, roles, limits, framing,
the render-commit marker, and snapshot validation.

This package is the normative source of truth for the protocol (see
`CONTRACTS.md`). It depends on `zod` and Node builtins only — never on React,
Ink, MCP, PTY, or the driver — so adapters and drivers can both import it
without dragging in each other's runtime.

Everything here **fails closed**: untrusted input is rejected with a typed
`ProtocolViolation` or a structured `{ ok: false, code, detail }` result, never
partially accepted.

## Install

```sh
pnpm add @termwright/protocol
```

## Usage

```ts
import {
  DEFAULT_LIMITS,
  createFrameDecoder,
  encodeFrame,
  encodeMarker,
  parseAdapterMessage,
  verifyMarkerPayload,
} from '@termwright/protocol';

// Driver side: decode length-prefixed frames off the socket.
const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);

socket.on('data', (chunk: Uint8Array) => {
  for (const frame of decoder.push(chunk)) {
    const result = parseAdapterMessage(frame, DEFAULT_LIMITS);
    if (!result.ok) {
      // 'bad-version' | 'malformed' | 'limit-exceeded' — close the session.
      return closeWith(result.code, result.detail);
    }
    if (result.message.type === 'snapshot') {
      // Already validated and deep-frozen; safe to retain.
      publish(result.message.snapshot);
    }
  }
});

// Adapter side: announce a committed render on stdout, then push the tree.
process.stdout.write(encodeMarker(token, sessionId, revision));
socket.write(encodeFrame({ type: 'revision-commit', revision }, DEFAULT_LIMITS.maxFrameBytes));

// VT layer: verify a DCS payload before trusting it (null on any mismatch).
const marker = verifyMarkerPayload(payload, token, sessionId);
```

## Surface

| Module | Provides |
|---|---|
| `env` | Env var names, `PROTOCOL_VERSION`, `PROTOCOL_ID` |
| `roles` | Closed `SEMANTIC_ROLES` / `SEMANTIC_ACTIONS` sets |
| `limits` | `DEFAULT_LIMITS`, `ABSOLUTE_LIMITS`, `ProtocolLimits` |
| `tree` | `SemanticSnapshot`, `SemanticNode`, `Rect`, `SemanticState` |
| `messages` | Message interfaces plus `parseAdapterMessage` / `parseDriverMessage` |
| `framing` | `createFrameDecoder`, `encodeFrame`, `projectDto` |
| `marker` | `encodeMarker`, `verifyMarkerPayload` |
| `validate` | `validateSnapshot` |
| `delta` | `TreeDelta`, `validateTreeDelta`, `applyTreeDelta` |
| `accesskit` | `toAccessKitTreeUpdate`, `accessKitNodeId`, role table |
| `errors` | `ProtocolViolation`, `ProtocolViolationCode` |

## Integrating the marker with a VT parser

The one trap in this package. `encodeMarker` emits
`ESC P t wm;{rev};{mac} ESC \`, where `t` is the DCS **final byte**. VT parsers
dispatch on that byte and consume it, so a handler registered on `{ final: 't' }`
receives only `wm;{rev};{mac}`. `verifyMarkerPayload` expects the payload
*including* the final byte, so prepend it — verified against `@xterm/headless`:

```ts
import { MARKER_DCS_FINAL, verifyMarkerPayload } from '@termwright/protocol';

term.parser.registerDcsHandler({ final: MARKER_DCS_FINAL }, (data) => {
  const marker = verifyMarkerPayload(MARKER_DCS_FINAL + data, token, sessionId);
  if (marker !== null) commit(marker.revision);
  return true; // consumed: keeps the sequence out of the visible grid
});
```

Forwarding the parser's `data` verbatim fails silently — every marker simply
returns `null`. A regression test in `marker.test.ts` pins this down.

The token is likewise **opaque**: whatever lands in `TERMWRIGHT_TOKEN` is what
both sides pass to the HMAC as the key. Never decode it to bytes first. Use
`generateToken()` so every client mints it the same way.

## Guarantees worth knowing

- **Log record ordering.** `LogRecord.seq` is **strictly increasing** within a
  session. A gap upward means records were dropped at the source (rate limit,
  queue overflow) and is expected under load; a duplicate or a decrease means
  the sender is broken, and the receiver rejects that record with a diagnostic.
  Keeping those two distinguishable is the whole point of the counter. This is
  a rule between records, so `validateLogRecord` cannot check it — it validates
  one record's shape, and the driver, which is the only party that sees the
  whole session, enforces the ordering.

- **Framing.** 4-byte big-endian length prefix + UTF-8 JSON. The declared
  length is checked against the ceiling *before* any body is read, so a
  four-byte header claiming 4 GB costs four bytes. Partial frames are buffered
  (never emitted); a violation poisons the decoder permanently rather than
  resynchronising on an attacker-chosen offset.
- **Projection.** Every decoded value passes through `projectDto`, which walks
  the graph with `Object.getOwnPropertyDescriptor` and rejects accessors,
  proxies, symbol keys, exotic prototypes, reserved keys (`__proto__`), sparse
  arrays, aliases and cycles, non-finite numbers, and unpaired surrogates. A
  getter on hostile input is **detected without being invoked**. The result is
  a deep-frozen plain copy sharing no references with the input.
- **Marker.** `\x1bPtwm;{revision};{mac}\x1b\\`, where the MAC is
  base64url(HMAC-SHA256(token, `${sessionId}:${revision}`)) truncated to 16
  bytes. Comparison is constant-time, revisions must be canonical decimal (`01`
  is not `1`), and the MAC binds session and revision so it cannot be replayed
  across either. `verifyMarkerPayload` is total: hostile input yields `null`.
- **Validation.** `validateSnapshot` enforces the §8.2 invariants: unique ids,
  parents that exist, acyclic parent chains, depth/count/byte ceilings,
  UTF-8 byte bounds on strings, safe-integer rects that intersect the viewport
  unless `state.hidden`, a positive revision, and a closed role/action set.
  Unknown properties are rejected, not ignored. Checks run cheapest-first, so
  a snapshot over the byte ceiling is rejected before any per-node work.

`bounds` is optional per node, and a snapshot carrying **no bounds at all** is
valid. Class-B/C frameworks publish role+name nodes without trustworthy
coordinates, and even a class-A adapter drops bounds wholesale when it cannot
observe its own offset (Ink does this when the tree contains `<Static>`).
Consumers must treat a bounds-free snapshot as a normal state, not a fault, and
fall back to their non-geometric path.

Two invariants are stricter than the prose spec strictly requires, and are
called out here because adapters must satisfy them: every node without a
`parentId` must appear in `rootIds`, and `labelledBy`/`describedBy` must
reference nodes present in the same snapshot.

## Tree deltas

With `subscribe: 'diffs'` an adapter sends `tree-delta` instead of a full
snapshot after each commit. A delta is bound to an **exact** base revision:

```ts
import { applyTreeDelta, validateTreeDelta } from '@termwright/protocol';

const checked = validateTreeDelta(body, limits);        // shape only
if (!checked.ok) return closeWith('malformed', checked.detail);

const composed = applyTreeDelta(held, checked.delta, limits);
if (!composed.ok) {
  // Never patch around a mismatch — ask for the whole tree instead.
  if (composed.code === 'revision') return requestFullTree();
  return closeWith('malformed', composed.detail);
}
```

**Composition semantics** (normative — every adapter and client must agree):

- `changed` upserts by id. A node already present is **replaced wholesale**,
  never field-merged: merging would need a third state meaning "unset this
  optional field", which the wire cannot express.
- `removed` removes each id **together with its subtree**. Cascade is what
  keeps deltas small — dropping a dialog is one id, not one per descendant —
  and it is the only rule that cannot leave orphans behind.
- `rootIds`, when present, replaces the root list. When absent the base roots
  carry over minus anything removed, so **introducing a new root requires
  sending `rootIds`**; otherwise the parentless node is missing from the root
  list and validation rejects it.
- Removals are applied **before** upserts, so one delta can rescue a node out
  of a subtree it also removes.

**The validation split matters.** `validateTreeDelta` checks only what is
knowable without the base: bounded sizes, well-formed nodes, unique ids, a
revision that moves forward. Parent existence, acyclicity, depth and whether
bounds intersect the viewport are properties of the *composed* tree — a delta
carries no viewport at all — so `applyTreeDelta` checks them by running the
result through `validateSnapshot`. A delta is never trusted to produce a valid
tree, only to describe one.

**Resynchronisation.** A base-revision mismatch, or a removal of a node the
receiver does not hold, means the producer's view and ours have diverged. Both
return a failure telling the caller to request a full snapshot via `get-tree`.
A speculative patch would produce a tree that looks fine and is wrong, and
every assertion downstream would inherit that error silently.

A delta cannot change the cursor, the viewport or the session id; those are
inherited from the base snapshot.

## AccessKit export (bridge-ready)

`toAccessKitTreeUpdate` converts a `SemanticSnapshot` into an AccessKit
`TreeUpdate` in its serde JSON shape. It is a pure transformation — this
package takes no dependency on AccessKit — so the output is data a bridge can
hand to a real adapter.

```ts
import { toAccessKitTreeUpdate } from '@termwright/protocol';

const { update, cellBounds } = toAccessKitTreeUpdate(snapshot, {
  toolkitName: 'ink',
  toolkitVersion: '7.1.1',
});
```

### Why there is no native bridge in 1.0

AccessKit's platform adapters attach a tree to a **native window**: an `NSView`
on macOS, an `HWND` on Windows, a toplevel on AT-SPI. A terminal application
has none of those. The emulator owns the window; the application under test is
a child process writing bytes to a pseudo-terminal. There is nothing for an
adapter to attach to, and no path for an assistive technology to route a
request back to us.

The geometry gap is the same problem from the other side. Our `bounds` are
**terminal cells** — row 3, column 12 — while AccessKit's `Rect` is in pixels
relative to the window origin. Converting needs the cell size and window
position, which live in the emulator, not in the process being tested. Guessing
a cell size would produce coordinates that look authoritative and point nowhere,
which is worse than having none.

So this is the half of the problem that can be solved correctly without a
window. `bounds` is emitted **only** when the caller passes `cellSize`, which
an embedder that owns the window (a GUI emulator embedding termwright) can do
honestly. Otherwise cell rects are returned separately as `cellBounds`, because
AccessKit's `Node` has no extension point for foreign coordinate systems and
smuggling cells into a pixel field would silently corrupt every consumer.

### Mapping notes

- **Focus is tree-level.** AccessKit puts `focus` on the `TreeUpdate`, not on a
  node, so the node carrying `state.focused` becomes the update's focus.
- **Children are explicit.** Our tree is flat and joined by `parentId`;
  AccessKit nodes carry a `children` array, derived here in snapshot order.
- **Ids are hashed.** AccessKit's `NodeId` is a `u64`, but JSON numbers are
  doubles, so `accessKitNodeId` takes SHA-256 of the id truncated to **53
  bits** — every id stays exactly representable, and a collision (about 1.4e-9
  at the 5 000-node ceiling) throws rather than merging two nodes.
- **`select` is dropped.** AccessKit has no selection action; mapping it onto
  `click` would claim a behaviour the adapter never described. `toggle` does
  map to `click`, which is how AccessKit expresses toggling.
- A multiline `textbox` becomes `multilineTextInput`.

### Schema provenance

Verified against `accesskit` 0.24.1 (docs.rs, August 2026):
`TreeUpdate { nodes, tree, tree_id, focus }`, `Tree { root, toolkit_name,
toolkit_version }`, `NodeId(u64)`, `Rect { x0, y0, x1, y1 }`, `TreeId(Uuid)`
with the nil UUID reserved for the root tree, and
`#[serde(rename_all = "camelCase")]` on `Role`, `Action` and `Node`.

One spelling could not be confirmed from the published docs: the serde
representation of the `Toggled` enum. This export emits `"true" | "false" |
"mixed"` for consistency with the crate's other public enums. Anyone building a
real bridge should check that against the adapter they link, and it is a
one-line change if it turns out to be `"True" | "False" | "Mixed"`.

## Protocol evolution

The protocol grows without a version bump only in ways an already published
client can survive. Anything else is a breaking change.

### Direction decides strictness

The two directions are read differently, and the difference is about **who is
speaking**, not about the message:

| Direction | Reader | Unknown fields |
|---|---|---|
| adapter → driver (`parseAdapterMessage`) | strict | rejected as `malformed` |
| driver → adapter (`parseDriverMessage`) | tolerant | ignored, and passed through |

Adapter traffic crosses the hostile-input boundary: it comes from a process
under test that may be broken or malicious, so an unknown field is a signal,
not an extension. The driver is the trusted party and behaviour there is
governed by negotiated capabilities, so a newer driver may add an optional
field without invalidating every adapter already published.

Tolerant does not mean lax. Known fields stay strictly type-checked, closed
sets stay closed, and unknown fields are *carried through* rather than
stripped, so a reader that does understand them still can.

**Additive — readers must tolerate these:**

- **New fields on any driver → adapter message**, including nested objects
  (`marker`, `logs`). `hello-ack.logs` is the worked example: **absent means
  the feature is off**, so an older driver that never sends it keeps working,
  and an adapter must not use a feature it was not explicitly granted.
- **New keys in `limits`.** Lenient in *both* directions — capacity is
  negotiated, so a driver learning a new ceiling must not invalidate adapters
  in the wild.
- **New capability strings.** The driver filters the adapter's advertised
  capabilities down to the ones it knows, so an adapter may advertise a
  capability a given driver has never heard of.
- **A new closed-set value that is gated behind a capability.**
  `subscribe: 'diffs'` is the worked example. Growing a closed set is normally
  breaking, and it still would be here — except the driver only ever selects
  `diffs` for an adapter that announced `tree-diffs` first. An adapter that has
  never heard of the value cannot be sent it, so the gate, not the set, is what
  makes this safe. Extending a closed set **without** such a gate stays
  breaking.

**Breaking — needs a coordinated release:**

- A new or renamed **required** field on any message.
- A new member of a **closed set** a reader must accept: message `type`,
  `error.code`, roles, actions, log levels, `subscribe`. These stay strict in
  both directions, precisely so unknown values fail loudly instead of
  acquiring behaviour by accident.
- Any new field on an **adapter → driver** message. That direction is strict,
  so adding one breaks every driver that has not been updated.
- Changing the meaning, units or clock of an existing field. Tightening
  `LogRecord.seq` from non-decreasing to strictly increasing is an example:
  nothing about the shape changed, but a sender that repeated a number was
  previously conforming and now is not.

The asymmetry is deliberate: *capacity* is negotiated and therefore extensible,
while *vocabulary* is closed and therefore fixed. When in doubt, ask whether a
reader that ignores the new thing still behaves correctly. If yes it is
additive; if it would silently do the wrong thing, it is breaking.

Cross-language clients (`clients/`) assert against generated vectors in
`clients/test-vectors/`. An additive change still requires regenerating those
vectors, because they pin exact constants.

## Development

```sh
pnpm --filter @termwright/protocol build      # tsup, ESM + d.ts
pnpm --filter @termwright/protocol typecheck  # tsc --noEmit
pnpm --filter @termwright/protocol test       # vitest
pnpm --filter @termwright/protocol test:hostile  # same suites, 128 MB heap cap
```

`test:hostile` pins the worker's old-space to 128 MB via `execArgv`, so
resource-exhaustion cases fail closed instead of passing by virtue of a large
default heap.
