---
title: Writing an adapter
description: The five obligations an adapter has, the traps that cost an afternoon each, and how to certify it in any language.
---

An adapter is small. It connects to a socket the driver already created,
completes a handshake, publishes a tree after each frame, and writes one escape
sequence. Everything hard about the protocol — the byte ceilings, the hostile
input handling, the validation — lives in the client library for your language.

Start from the [protocol reference](../../reference/protocol/) for the wire
format. This page is the adapter author's checklist.

## The five obligations

The [conformance suite](#certifying-it) asserts exactly these, so an adapter
that satisfies them is done by definition.

### 1. The dormant rule

Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the environment, the
adapter **opens nothing, allocates nothing, emits nothing**, and the
application's output is byte-for-byte what it would have been. Every client
expresses this as a constructor that returns nothing —
`client_from_env() -> None`, `protocol.FromEnv() == nil`,
`Client::from_env() -> None`, `termwright.Attach() -> (nil, nil)` — so the
calling app needs no feature flag and shipping the adapter in production costs
one import.

### 2. The handshake

Send `hello` first and exactly once, carrying the token from the environment,
the protocol id, a non-empty adapter name and version, and a capability list
drawn from the closed set. The driver replies with the selected version, the
session limits and the marker configuration.

No valid hello within the negotiation window (250 ms by default) means the
session continues generically with `semanticTree: false`. A late or malformed
hello never flips an already-selected mode.

### 3. Valid snapshots

Every snapshot must pass validation: unique ids, parents that exist, acyclic
parent chains, depth / count / byte ceilings, a positive strictly increasing
revision, roles and actions from the closed sets. Unknown properties are
rejected, not ignored.

Two invariants are stricter than the prose and catch most first attempts:

- every node without a `parentId` must appear in `rootIds`;
- `labelledBy` / `describedBy` must reference nodes present in the same
  snapshot.

If you truncate a large tree, never emit a child after its parent was dropped —
point `parentId` at the nearest *published* ancestor and push ancestors first.

**`bounds` is optional.** Publish it only where it is trustworthy. A snapshot
with no bounds at all is valid, and consumers treat it as a normal state.

#### Validate the tree you built, not the one that came back

:::caution[TypeScript adapters only]
This trap comes from sharing a heap with the consumer. The Python, Go and Rust
clients serialize on the way out, so an alias cannot survive to reach
validation — nothing below applies to them.
:::

At least one test must call `validateSnapshot` on a snapshot your collector
returned **in memory**, with no serialization anywhere between the two. That is
the whole obligation, and it is a property of the *path*, not of the fixture:
elaborate trees prove nothing if the value being validated has been through
JSON. One of the shipped adapters had trees with fifty `button` nodes and a
green suite for exactly that reason.

The bug it catches is aliasing. `validateSnapshot` rejects a snapshot in which
any value is reachable twice, and there are two easy ways to produce one: a role
table that hands the same frozen `actions` array to every node of that role, and
an application author who reuses one array across two annotations. Framing is
`JSON.stringify`, which has no concept of reference identity — so the wire looks
perfectly clean while the in-process consumers (`mountInk`, a `getTree`
response) get an object the validator throws out.

```ts
import {DEFAULT_LIMITS, validateSnapshot} from '@termwright/protocol';

it('gives each node its own actions array, whatever the source', () => {
  // Straight from the collector, validated as-is. An encodeFrame anywhere in
  // between copies away the very thing this test exists to catch.
  const snapshot = collect(root, registry);

  expect(validateSnapshot(snapshot, DEFAULT_LIMITS)).toMatchObject({ok: true});

  // Optional, but it names the failure when it happens.
  const [first, second] = snapshot.nodes.filter((node) => node.role === 'button');
  expect(first?.actions).toEqual(second?.actions);
  expect(first?.actions).not.toBe(second?.actions);  // equal, never the same array
});
```

Copy at the node-construction site, so neither source of aliasing can reach a
snapshot in the first place.

### 4. Ordering: snapshot, commit, marker

Per revision, in this order: the snapshot frame, the `revision-commit`, then the
marker on stdout — **after the last byte of that frame has been flushed**. The
marker commits the bytes that precede it. Emitting it earlier lets the driver
act on a paint that has not landed, which is the single most common adapter bug.

Markers must strictly increase.

### 5. Surviving channel loss

Cutting the socket leaves the application rendering and alive, and the adapter
does not reconnect. An adapter never throws across its own boundary: a refused
connection, a rejected token, a malformed frame or a driver that vanished all
disable semantics silently.

## Deriving roles and names

Role resolution is a three-level fallback, normative for every adapter:

1. an explicit author annotation;
2. the framework's widget-type map (`Button` → `button`, and so on, matched
   along the inheritance chain so a user's subclass still resolves);
3. `generic`.

Names come from whatever the framework calls a label, then a title, then the
rendered text — and an author override always wins. Publish the framework's own
stable identifier (a DOM id, a widget key) as `testId`: an author-supplied id is
a promise of stability, and it is the first thing the
[selector generator](../../guides/runner-ui/) reaches for.

Roles stay ARIA-aligned on purpose, so a future bridge to AccessKit or AT-SPI
stays possible.

## Two traps

**Prepend the DCS final byte before verifying a marker.** VT parsers dispatch on
the final byte and consume it, so a handler registered on `{final: 't'}` receives
only `wm;{rev};{mac}` while `verifyMarkerPayload` expects the payload
*including* that byte. Forwarding the parser's data verbatim fails silently:
every marker simply returns `null`.

**The token is opaque.** Whatever lands in `TERMWRIGHT_TOKEN` is what both sides
pass to the HMAC as the key — never decode it to bytes first.

## Certifying it

The contract suite drives your app as a subprocess and observes only bytes and
frames, so a Python, Go or Rust adapter certifies exactly like the TypeScript
one:

```ts
import {runAdapterConformance} from '@termwright/conformance';

await runAdapterConformance({
  name: 'termwright-py',
  spawn: () => ({command: ['python', 'examples/demo_app.py']}),
  // Optional: the same UI with the adapter compiled out. When given, the
  // dormant run is compared against it byte for byte.
  baseline: () => ({command: ['python', 'examples/demo_app.py'], env: {PLAIN: '1'}}),
  ready: 'Ready',
  interaction: {input: '\t', expect: '[Save]'},
  quit: {input: '', exitCode: 0},
  columns: 80,
  rows: 24,
  expectAbsoluteBounds: true,
});
```

`await` it at the top level: `vitest` is imported dynamically, so the package
also works from a plain script.

For the protocol layer itself, run the shared **cross-language test vectors** in
`clients/test-vectors/`: exact frame bytes, marker MACs including a non-ASCII
token, ten forgeries that must not verify, and 24 invalid trees with their
validation codes. They are generated from the reference TypeScript
implementation, and the generator re-runs every expectation through it before
writing, so a stale or hand-edited vector fails at generation time.

## Publish it

Adapters live outside this repository perfectly well. If yours certifies, open
an issue — the [adapter overview](../) is the list users read before they choose
a framework, and being on it is the point of certifying.
