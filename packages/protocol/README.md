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

Two invariants are stricter than the prose spec strictly requires, and are
called out here because adapters must satisfy them: every node without a
`parentId` must appear in `rootIds`, and `labelledBy`/`describedBy` must
reference nodes present in the same snapshot.

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
