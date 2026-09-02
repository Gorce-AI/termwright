# @termwright/protocol

The language-neutral semantic wire contract used by Termwright probes and the
driver. This package defines message shapes, semantic trees, observations,
framing, limits, render markers, validation, probe metadata, and structured
application logs.

It depends on Zod and Node built-ins only. Framework probes and the driver can
import it without pulling in React, Ink, MCP, PTY, or UI code.

## Install

```sh
pnpm add @termwright/protocol
```

## Current protocol

The only supported protocol id is `termwright/3` (`PROTOCOL_VERSION === 3`).
Every semantic snapshot has `v: 3` and uses evidence-qualified observations.
The endpoint and token select the private semantic session; clients do not
choose a protocol at runtime.

The first semantic revision and every resynchronization use `semantic-full`.
Incremental producers then publish revision-based `semantic-delta` messages;
full-only producers may keep publishing `semantic-full`.

## Package surface

| Module           | Provides                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `env`            | Endpoint/token names, `PROTOCOL_VERSION`, `PROTOCOL_ID`                                      |
| `roles`          | Closed semantic role and action vocabularies                                                 |
| `limits`         | Default, absolute, and negotiated protocol limits                                            |
| `tree`           | `SemanticSnapshot`, `SemanticNode`, observations, rectangles, portable state, extended state |
| `node-keys`      | Closed semantic-node key set shared by validators                                            |
| `probe`          | Probe IR, metadata, identity, capability, and provenance vocabularies                        |
| `logs`           | Structured application-log records and validation                                            |
| `messages`       | Wire message types and both directional parsers                                              |
| `framing`        | Length-prefixed JSON framing and hostile-data projection                                     |
| `marker`         | Authenticated render-marker encoding and verification                                        |
| `validate`       | Full snapshot validation                                                                     |
| `semantic-state` | Deterministic diff, atomic delta application, and resynchronization semantics                |
| `accesskit`      | Pure conversion to AccessKit-compatible data                                                 |
| `errors`         | Typed protocol violations                                                                    |
| `run-state`      | Closed run lifecycle, terminal verdicts, and transition validation                           |

`passed-with-skips` is a terminal run verdict distinct from both plain
`passed` and fully `skipped`. It preserves partial-skip evidence for hosts and
UIs; whether that verdict certifies is decided by the host's exact skip policy,
not by the protocol state alone.

## Decode adapter traffic

```ts
import { DEFAULT_LIMITS, createFrameDecoder, parseAdapterMessage } from '@termwright/protocol';

const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);

socket.on('data', (chunk: Uint8Array) => {
  for (const frame of decoder.push(chunk)) {
    const result = parseAdapterMessage(frame, DEFAULT_LIMITS);
    if (!result.ok) {
      closeWith(result.code, result.detail);
      return;
    }

    if (result.message.type === 'semantic-full') {
      retain(result.message.snapshot); // validated and immutable
    }
  }
});
```

All decoded values pass through `projectDto`. Projection rejects getters,
proxies, symbol keys, exotic prototypes, reserved keys, sparse arrays, aliases,
cycles, non-finite numbers, and unpaired surrogates. It returns a deep-frozen
plain copy that shares no references with the input.

## Handshake

The adapter sends `hello` first and exactly once:

```ts
{
  type: 'hello',
  protocol: 'termwright/3',
  token,
  adapter: {name: 'my-probe', version: '1.0.0'},
  capabilities: ['tree', 'states', 'actions', 'render-revisions'],
  probe: {
    framework: 'my-framework',
    probeVersion: '1.0.0',
    identityKind: 'stable',
    capabilities: ['visible-rect'],
    instrumentation: {
      highestTier: 'T0',
      semanticClass: 'A',
      degradedCapabilities: [],
    },
  },
}
```

`probe` is present for a framework probe and omitted for a hand-written
adapter. Adapter capabilities describe optional wire traffic or guarantees.
Probe metadata describes the framework facts that were actually audited.

The driver replies with `hello-ack` containing the same protocol id, a session
id, active limits, the `semantic` subscription, marker configuration, and an optional
log budget.

Unknown protocol ids are reported as `bad-version`. A malformed hello is never
partially accepted.

## Semantic publication

After a framework completes a render, the producer publishes in this order:

1. `semantic-full` or `semantic-delta` containing semantic revision N;
2. `revision-commit` for N;
3. the authenticated OSC marker after the terminal bytes for N are flushed.

Every delta names `baseRevision`. A receiver applies it to staging state,
validates the reconstructed tree and evidence, and publishes it atomically.
When the base is absent or different, the receiver sends
`semantic-resync-request`; the producer's next publication is a full tree.
Absent patch fields mean unchanged, while `clear` explicitly removes an
optional field.

A full snapshot includes the session id, revision, viewport, optional cursor,
roots, all nodes, coordinate-space observation, and hit-grid observation. Each
node contains required geometry observations:

```ts
interface NodeGeometryObservations {
  displayed: Observation<boolean>;
  intendedRect: Observation<Rect>;
  visibleRect: Observation<Rect>;
}
```

## Observations

Physical facts use `Observation<T>` so missing evidence cannot become a false
boolean or guessed rectangle:

| Status        | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `known`       | The value is present with structurally validated provenance                  |
| `absent`      | Authoritative provenance proves the fact does not exist in this state        |
| `unknown`     | A revision pair, provider refresh or stale revision is temporarily unsettled |
| `unsupported` | The frozen session contract does not provide the capability                  |

`intendedRect` and `visibleRect` are different facts. A producer must not copy
the intended rectangle into the visible field when clipping is unavailable.
Permanent unobservability is `unsupported`, never `unknown`; committed
guaranteed observations may only settle as `known` or `absent`.

The snapshot-level coordinate space qualifies every known rectangle. Geometry
in framework-local cells is inspectable but cannot be used as terminal-input
coordinates.

## Pointer ownership

A known `hitGrid` contains canonical, non-overlapping, row-major runs. Every
run has positive width, `height: 1`, and a `recipientId` referring to a node in
the same snapshot.

Only the framework's fresh-pointer routing result can establish ownership.
Paint order, z-index, overlap, or a visible rectangle do not prove which widget
will receive input. A framework that cannot provide an exact map publishes an
`unknown` or `unsupported` hit-grid observation.

## Semantic conventions

The role vocabulary is closed and ARIA-aligned. An explicit application
annotation takes precedence over a framework widget mapping; an unrecognised
widget uses `generic` and must include its native `frameworkType`.

Names and values remain separate. `value: ''` is a known empty value; omitting
`value` means the node does not expose one. Application-specific JSON belongs
under `extended`, not in the portable state namespace.

`p` records a node's primary provenance and `px` records exceptions. The
provenance vocabulary is `annotation`, `recognizer`, `framework`,
`correlation`, or `heuristic`.

Annotations may supply semantic intent such as role, name, relationships,
actions, stable identity, and domain state. They must not override measured
focus, rendered text, geometry, clipping, or pointer routing.

An unrecognised framework node sets `opaqueChildren: true` when the probe
cannot prove that its child enumeration is complete. This is a typed,
framework-provenance degradation boundary; it must not be hidden in
application-specific `extended` data.

## Snapshot validation

`validateSnapshot` checks:

- literal snapshot version `2`;
- encoded byte size before per-node work;
- positive revision and valid viewport/cursor coordinates;
- bounded node count, tree depth, strings, relationships, and extended JSON;
- unique ids, existing parents, acyclic ancestry, and complete `rootIds`;
- relationships targeting nodes in the same snapshot;
- required, well-formed observations;
- safe-integer rectangles and canonical hit-grid runs;
- closed role, action, state, observation, and provenance sets;
- rejection of unknown properties.

Validation returns `{ok: true, snapshot}` or a structured failure with a stable
code and detail. It does not retain a partially valid tree.

## Framing

Messages use a four-byte big-endian length followed by UTF-8 JSON. The receiver
checks the declared size before reading the body. Partial frames are buffered
and never emitted. A framing violation permanently poisons that decoder.

`DEFAULT_LIMITS` defines normal ceilings. A session may tighten them through
`hello-ack`; it cannot widen `ABSOLUTE_LIMITS`.

## Render marker

`encodeMarker` emits:

```text
ESC ] 8487 ; twm;{revision};{mac} BEL
```

The MAC is base64url(HMAC-SHA256(token,
`${sessionId}:${revision}`)), truncated to 16 bytes. Comparison is
constant-time and revisions use canonical decimal text.

Register OSC code `8487` with the VT parser and pass the payload after the OSC
number and separator to `verifyMarkerPayload`. A trailing BEL or ST is
tolerated because raw-stream scanners may retain the terminator.

## Structured logs

An adapter announcing `logs` receives a source-side rate budget in
`hello-ack`. Without that budget it sends no records. `LogRecord.seq` increases
strictly within a session; an upward gap reports records dropped at the source,
while duplicates or decreases are protocol errors.

## Directional strictness

Adapter-to-driver traffic is strict: unknown fields are rejected. It crosses
an untrusted process boundary, so an unexpected field is a protocol error.

Driver-to-adapter traffic tolerates unknown additive fields while still
validating known fields and closed sets. This lets a newer driver add optional
metadata without breaking an already published client.

## Cross-language conformance

`clients/test-vectors/` contains reference-generated frame bytes, hostile
cases, marker sequences, observation cases, and valid and invalid v3
snapshots. The generator validates each expectation before writing it.

Framework integrations should also run `@termwright/conformance` against a
real subprocess. A claimed observation is accepted only when the framework
fixture demonstrates the same fact independently.

## Protocol evolution

Before 1.0, wire-breaking changes replace the previous protocol across all
built-in clients; old semantic readers and negotiation paths are removed.
Changing a required field, closed-set member without a gate, encoding, unit, or
observable meaning requires a coordinated protocol-major change.
