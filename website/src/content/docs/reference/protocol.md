---
title: Semantic protocol
description: Transport, handshake, full snapshots, render markers, validation, and protocol ceilings.
---

The semantic protocol connects an in-process framework probe to the Termwright
driver. `@termwright/protocol` is the normative implementation. Other language
clients must produce the same wire shapes and validation outcomes.

Termwright has one current protocol id: `termwright/2`. A snapshot always has
`v: 2`, evidence-qualified geometry, a coordinate-space observation, and a
pointer hit-grid observation. Missing evidence is represented explicitly; it
is never projected into a guessed boolean or rectangle.

## Transport and lifecycle

The driver creates a private endpoint before spawning the child: a Unix socket
inside a mode-`0700` temporary directory on macOS and Linux, or an unguessable
named pipe on Windows. The semantic channel never listens on TCP.

The child receives two variables:

| Variable              | Meaning                        |
| --------------------- | ------------------------------ |
| `TERMWRIGHT_ENDPOINT` | Unix socket or named-pipe path |
| `TERMWRIGHT_TOKEN`    | Opaque 256-bit session secret  |

Without both values, a probe stays dormant: it opens no connection, writes no
marker, and does not change the application's terminal output.

The probe sends one bounded `hello` containing:

- protocol id `termwright/2`;
- the token;
- a non-empty adapter name and version;
- capabilities for optional traffic and authoritative observations such as
  `intended-geometry`, `clipped-geometry`, or `pointer-hit-grid`;
- probe metadata when the sender is a framework probe.

The driver replies with `hello-ack`, the same protocol id, a session id, active
limits, the snapshot subscription, marker configuration, and an optional log
budget. A malformed, rejected, or late handshake does not turn a generic
terminal session into a semantic session.

## Framing

Every socket message is UTF-8 JSON preceded by a four-byte big-endian length.
The receiver checks the declared length before reading the body. Partial frames
are buffered and never emitted. A framing violation poisons the decoder instead
of attempting to resynchronise at an attacker-controlled byte offset.

Decoded values are projected into immutable plain data. Projection rejects
accessors, proxies, symbol keys, exotic prototypes, reserved keys, sparse
arrays, aliases, cycles, non-finite numbers, and unpaired surrogates. The
validated result shares no mutable references with the input.

## Full snapshot stream

Each committed semantic revision uses a complete snapshot. The producer sends:

1. `snapshot { snapshot }`;
2. `revision-commit { revision }`;
3. the authenticated terminal marker after the rendered terminal bytes have
   been flushed.

The driver may subscribe to `revisions` when it does not need trees. Otherwise
the producer sends a full snapshot for every semantic revision.

The full snapshot is the recovery boundary by construction. A receiver can
validate and retain each revision independently without composing it with
earlier application state.

## Render marker

The stdout marker commits a rendered frame; it is not a data channel.

```text
ESC ] 8487 ; twm;{revision};{mac} BEL
```

`mac` is the base64url encoding of
`HMAC-SHA256(token, "{sessionId}:{revision}")`, truncated to 16 bytes.
Comparison is constant-time. Revision text must be canonical decimal, and the
MAC binds both the session and revision.

Register an OSC handler for code `8487` and pass the remaining payload to
`verifyMarkerPayload`:

```ts
import { MARKER_OSC_CODE, verifyMarkerPayload } from '@termwright/protocol';

terminal.parser.registerOscHandler(MARKER_OSC_CODE, (data) => {
  const marker = verifyMarkerPayload(data, token, sessionId);
  if (marker !== null) commit(marker.revision);
  return true;
});
```

The driver exposes revision N only after it has both the complete semantic
snapshot for N and the terminal grid at marker N. Superseded incomplete pairs
are discarded with a diagnostic.

## Snapshot model

A `SemanticSnapshot` contains:

- `v: 2`, `sessionId`, and a positive `revision`;
- terminal `columns` and `rows`;
- `rootIds` and a complete `nodes` array;
- an optional cursor;
- `coordinateSpace: Observation<CoordinateSpace>`;
- `hitGrid: Observation<PointerHitGrid>`.

Each `SemanticNode` contains identity, hierarchy, role, name, optional value and
description, portable state, application-owned `extended` JSON, action hints,
relationships, text ranges, a test id, provenance, and required geometry:

```ts
interface NodeGeometryObservations {
  displayed: Observation<boolean>;
  intendedRect: Observation<Rect>;
  visibleRect: Observation<Rect>;
}
```

An unrecognised framework widget uses `role: 'generic'` and must include its
native `frameworkType`. When a probe cannot determine whether that widget owns
additional framework children, it also sets `opaqueChildren: true`; consumers
must treat the node as an explicitly incomplete container boundary, not as a
known leaf.

`p` records a node's primary provenance and `px` records per-field exceptions.
The provenance vocabulary is closed: `annotation`, `recognizer`, `framework`,
`correlation`, or `heuristic`.

See [Geometry, visibility and pointer ownership](../geometry-visibility/) for
observation states and the exact pointer-ownership contract.

## Snapshot validation

`validateSnapshot` checks untrusted data before it is retained. It enforces:

- the literal snapshot version `2`;
- unique node ids and root ids;
- existing parents and acyclic parent chains;
- every parentless node appearing in `rootIds`;
- relationships targeting nodes in the same snapshot;
- bounded depth, counts, strings, JSON data, and encoded bytes;
- safe-integer rectangles and canonical hit-grid runs;
- a positive revision and valid cursor coordinates;
- closed role, action, state, observation, and provenance vocabularies;
- rejection of unknown properties.

Validation checks size ceilings before per-node work. Failures return a stable
code and detail rather than a partially accepted tree.

## Protocol limits

The handshake supplies the active `ProtocolLimits`. A driver may tighten the
published defaults but cannot widen the absolute ceilings. Limits cover frame
and snapshot bytes, tree depth, node count, string bytes, relation targets,
in-flight work, waits, and structured logs.

The negotiated semantic in-flight ceiling defaults to 32 frames. Compatible
probes may use it as their local publication budget; Ratatui does. If Ratatui
exhausts it, the probe fails closed and reports both the active budget and the
remediation. For applications that intentionally render larger synchronous
bursts, raise it per launch (up to the protocol ceiling of 256):

```ts
const app = await terminal.launch({ semanticFrameQueueCapacity: 64 });
```

This is a memory/backpressure budget, not a retry or timing control.

Driver messages are tolerant of unknown additive fields so a published client
can continue talking to a newer driver. Adapter messages remain strict because
they cross an untrusted boundary. Known fields and closed vocabularies keep
their exact types in both directions.

## Cross-language vectors

`clients/test-vectors/` contains fixtures generated from the TypeScript
reference implementation: frame bytes, hostile frames and error codes, marker
sequences, observation cases, and valid and invalid v2 snapshots. The generator
re-validates each expectation before writing it.

## Versioning

`PROTOCOL_ID` is `termwright/2` and `PROTOCOL_VERSION` is `2`. Additive changes
must remain readable by existing v2 clients. A change that invalidates a valid
v2 producer frame requires a future protocol major.
