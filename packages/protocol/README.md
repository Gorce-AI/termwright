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

## Protocol evolution

The protocol grows without a version bump only in ways an already published
client can survive. Anything else is a breaking change.

**Additive — readers must tolerate these:**

- **New keys in `limits`.** The reference parser reads the `limits` object of
  `hello-ack` *leniently*: unknown keys are ignored, not rejected, and are
  carried through to the caller so a reader that does understand them still
  can. Known keys stay strict about their type. This is the one lenient object
  on the wire, and it exists because a driver learning a new ceiling must not
  invalidate every adapter already in the wild.
- **New optional fields on a message.** `hello-ack.logs` is the worked example:
  **absent means the feature is off**, so an older driver that never sends it
  keeps working unchanged, and an adapter must not use a feature it was not
  explicitly granted.
- **New capability strings.** The driver filters the adapter's advertised
  capabilities down to the ones it knows, so an adapter may advertise a
  capability a given driver has never heard of.

**Breaking — needs a coordinated release:**

- A new or renamed **required** field on any message.
- A new member of a **closed set** a reader must accept: message `type`,
  `error.code`, roles, actions, log levels, `subscribe`. These stay strict
  precisely so unknown values fail loudly instead of acquiring behaviour by
  accident.
- Changing the meaning, units or clock of an existing field.

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
