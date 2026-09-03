---
title: Write a framework integration
description: Build and certify a semantic probe for a TUI framework that Termwright does not yet support.
pagefind: false
---

Write an integration when a framework has useful component state that cannot be
recovered from terminal cells. A probe observes that state inside the
application process and publishes semantic state for each rendered frame.

This is an adapter-author guide. Application tests should start with
[generic terminal mode](../../adapters/) or an existing integration.

## Choose an integration strategy

| Framework design                        | Normal strategy                                     |
| --------------------------------------- | --------------------------------------------------- |
| Retained widget tree with public hooks  | Runtime preload or lifecycle hook                   |
| Retained tree with private layout state | Exact-version build instrumentation                 |
| Immediate-mode rendering                | Observe frame render calls in an instrumented build |
| Rendered string with a structured model | Observe the model and publish frame-local nodes     |

Do not infer component geometry from paint order or rendered text. Publish a
fact only when the framework exposes evidence for it.

## Use the protocol client

Termwright ships protocol clients for TypeScript, Python, Go, and Rust. Start
from the client for the framework's language rather than implementing framing,
limits, marker authentication, or hostile-input validation again.

A probe must remain dormant unless both `TERMWRIGHT_ENDPOINT` and
`TERMWRIGHT_TOKEN` are present. Outside a test it must open no connection and
must not change terminal output.

## Open the semantic session

Send one `hello` with:

- protocol `termwright/3`;
- a non-empty adapter name and version;
- the capabilities the probe can actually provide;
- `intended-geometry` only for authoritative layout rectangles;
- `clipped-geometry` only for authoritative visible rectangles;
- `pointer-hit-grid` only when the framework exposes exact fresh-pointer routing.

Wait for the acknowledgement and session limits before publishing snapshots.
A malformed or late handshake does not upgrade an already generic session.

## Build semantic nodes

Use the shared vocabulary and precedence:

1. an explicit application annotation;
2. a framework widget or component mapping;
3. `generic`.

Names follow this order:

1. explicit annotation, including an intentional empty string;
2. native label, title, or placeholder;
3. descendant text for name-from-content roles;
4. stable native identifier.

Keep `name` and `value` separate. Empty string is a known empty value; an
omitted value means the widget does not expose one. Publish state only from a
native flag or explicit application annotation.

Every snapshot needs unique ids, valid parents, acyclic ancestry, complete
roots, valid relationships, a strictly increasing revision, and values within
the negotiated size limits. TypeScript collectors must also avoid shared array
or object references between nodes.

## Publish qualified observations

Geometry, visibility, and pointer ownership use `Observation<T>`:

- `known` includes the value and evidence;
- `absent` means the node has no such fact in this state;
- `unknown` means the probe could not establish the fact for this revision;
- `unsupported` means the framework cannot provide the capability.

Do not turn unknown into `false`, copy an intended rectangle into a visible
rectangle, or derive pointer ownership from z-order. Exact pointer support
requires the same hit-routing result the framework uses for a fresh pointer at
each terminal cell.

## Commit a rendered revision

Publish the first frame as a full snapshot. Later frames can use revision-based
deltas when the integration knows what changed. For each frame, publish in this
order:

1. a full snapshot or a delta based on the currently committed revision;
2. `revision-commit`;
3. the authenticated terminal marker, after all bytes for the frame are flushed.

Markers must increase strictly. Publishing the marker before the terminal frame
allows an action to target state that is not on screen yet.

If the semantic channel closes, keep the application running and rendering.
The probe disables semantics and does not reconnect inside that process.

## Add application annotations

Keep an annotation SDK separate from the probe. Annotations may add stable
identity, role, name, description, test id, relationships, supported actions,
and JSON domain state. They must not override physical facts such as rendered
text, focus, geometry, clipping, or pointer routing.

Document every framework limitation in the integration page and capability
registry. An undeclared difference is a bug.

## Certify the integration

The conformance suite drives a real subprocess and compares observable bytes,
snapshots, actions, and teardown:

```ts
import { runAdapterConformance } from '@termwright/conformance';

await runAdapterConformance({
  name: 'my-framework',
  spawn: () => ({ command: ['my-app'] }),
  baseline: () => ({ command: ['my-app'], env: { DISABLE_PROBE: '1' } }),
  ready: 'Ready',
  interaction: { input: '\t', expect: '[Save]' },
  quit: { input: '', exitCode: 0 },
  columns: 80,
  rows: 24,
});
```

The integration also needs:

- dormant byte-parity coverage;
- handshake and hostile-input tests;
- full snapshot and delta validation before serialization;
- render/commit/marker ordering tests;
- disconnect and teardown tests;
- real framework process tests for each claimed observation;
- cross-language observation vectors where applicable;
- a row in the machine-readable compatibility registry;
- a task-oriented framework page in these docs.

Use the [semantic protocol reference](../../reference/protocol/) for exact frames
and limits, and [geometry and visibility](../../reference/geometry-visibility/)
for observation and hit-grid rules.
