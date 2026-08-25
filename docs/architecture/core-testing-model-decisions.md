# Core testing model — architectural decisions

Status: accepted. These decisions define the public and wire-level invariants of
the Termwright testing model. Framework audits and compatibility rows may add
facts, but may not weaken these invariants.

## ADR-10 — Effective Session Contract

Termwright negotiates one Effective Session Contract before a test receives a
settled session. The contract composes a certified adapter, exact Termwright
instrumentation, application evidence providers, and terminal input/emulation
capabilities. It has a stable identity and does not gain or lose capabilities
during its session epoch.

Provider data and terminal modes may change at runtime. The existence of a
capability may not. Late provider registration is rejected or starts a new
session epoch; it never mutates the current contract.

## ADR-11 — Evidence provenance has independent dimensions

Every authoritative or diagnostic physical observation identifies its source,
method, strength, and provider. An application exposing its real production
router can therefore be authoritative, while a framework-derived recognizer can
remain diagnostic. Source and strength are not aliases.

Consumers validate provenance structurally. A heuristic or diagnostic fact may
appear in traces and the Runner, but cannot satisfy an action requirement.

## ADR-12 — Public capabilities are never structurally conditional

Adapter descriptors may describe conditions needed during certification and
negotiation. A negotiated session exposes only supported or unsupported
capabilities. It cannot make an operation available for one node, unavailable
for the next, and available again because an internal render path happened to
publish more data.

When an integration cannot guarantee a fact across its certified contract, the
solution is stronger instrumentation, a separate certified contract, an
explicit application provider, or unsupported capability.

## ADR-13 — Framework baselines compose with application providers

A framework adapter supplies the strongest automatic contract it can prove.
Applications may add independently versioned evidence providers for production
facts the framework does not own, such as pointer routing in Ink, Ratatui, or
Bubble Tea applications. Provider capabilities compose; package variants such
as `ink-with-pointer-and-scroll` do not.

This composition changes evidence available to the planner, never the execution
path. Input still crosses the PTY.

## ADR-14 — Evidence Providers are not annotations

Annotations attach descriptive semantics: role, name, value, state, and an
explicit semantic key. They cannot manufacture layout, clipping, painting,
focus, or pointer ownership.

An Evidence Provider is an executable, revision-bound integration with the
application's production state. It has a stable identity, version, declared
capabilities, validation, lifecycle, and diagnostics. A conforming provider may
publish authoritative physical facts.

## ADR-15 — End-user actions use real terminal input only

All keyboard and pointer actions are encoded as terminal input and written to
the child PTY. Framework hooks and application providers may supply evidence;
they may not dispatch callbacks, invoke handlers, or mutate framework state on
Termwright's behalf.

Conformance fixtures must distinguish a real terminal event from a direct
handler call. A bypass is a correctness failure, even if the application reaches
the expected state.

## ADR-16 — ActionPlanner is the actionability authority

A semantic action intent is resolved against one committed observation frame and
converted into an explicit ActionPlan before any byte is sent. The plan records
the target, requirements, evidence, chosen strategy, physical point or path,
terminal mode, and device operations.

Locator actions, public actionability explanations, MCP, Recorder, Runner, and
trace views use this planner. Diagnostic surfaces may format a plan differently;
they may not reimplement or approximate its decision.

## ADR-17 — Keyboard and Mouse are the physical device boundary

The driver owns one Keyboard implementation and one Mouse implementation.
Convenience harness methods delegate to Keyboard. Semantic Locator actions use
ActionPlanner and then the same devices. Raw coordinate click, wheel, and drag
belong to Mouse rather than Locator.

The Mouse encodes input from the terminal emulator's authoritative current
tracking and encoding modes. Unknown modes never fall back to speculative SGR
bytes.

## ADR-18 — Exact certification when internals carry guarantees

An adapter that depends on private fields, render pipelines, checksummed source
replacement, or internal routing is certified against an exact upstream artifact
and Termwright patch set. Certification records artifact checksums, adapter and
patch versions, conformance coverage, and the resulting capabilities.

A newer release does not inherit certification from a semver range or a partial
feature probe. It remains generic, unsupported, or explicitly experimental until
the exact artifact passes certification.

## ADR-19 — Observation states have strict meanings

`known` and `absent` are authoritative results for one committed observation and
carry provenance. `unknown` is temporary and states which revision domain can
settle it. `unsupported` means the fact is outside the frozen contract and is
never retried.

A settled guaranteed observation must be `known` or `absent`. Missing,
`unknown`, or `unsupported` evidence is an adapter/provider guarantee violation,
not graceful degradation.

## ADR-20 — Certified and diagnostic evidence stay separate

Termwright retains useful non-universal evidence for the Runner, traces,
instrumentation debugging, and conformance diagnostics. That evidence is marked
diagnostic and cannot opportunistically enable public operations for individual
nodes.

This permits rich inspection without turning an adapter's API into a function of
which built-in or custom widget happened to render.

## ADR-21 — Stable identity is native, explicit, or frame-local

Retained framework object identity is stable when the certified adapter proves
it. An application `SemanticKey` is also stable and its uniqueness is a contract;
duplicates fail with `TW_DUPLICATE_SEMANTIC_KEY`.

Immediate/value-oriented renderers may publish frame-local identities. Termwright
does not correlate them across revisions by role, name, text, array index,
geometry, or structural similarity.

## ADR-22 — Geometry, clipping, painting, and pointer regions are distinct

`intendedRect` describes layout intent. A clip region describes cells surviving
ancestor and viewport clipping. A painted region describes attributable cells
that survived the committed render. A pointer region describes cells assigned by
the production input router. None implies another without a certified invariant.

Physical regions may use row spans when ownership is disjoint. A single bounding
rectangle is not accepted as proof that every enclosed cell is visible or
interactive.

An application provider may explicitly contract that its published row spans
are the cells currently owned by its production pointer router. That
authoritative region contract is sufficient without a second hit-test API; it
is not inferred from layout geometry. If any hit-test provider is negotiated,
the planner must intersect and verify every candidate against that committed
ownership map and must not fall back to region-only behavior on disagreement.

## ADR-23 — Visibility is a canonical condition, not a vague boolean

Attachment, display state, viewport intersection, clipping, painting, occlusion,
and pointer reachability are separate observations. `visible` has one definition
in the canonical Condition evaluator and the same result is consumed by waits,
assertions, ActionPlanner, MCP, and Runner.

Lower-level conditions remain available where a test needs to distinguish
displayed, in-viewport, painted, or pointer-interactable state. Negating an
unknown condition remains inconclusive; it does not become success.

## ADR-24 — Provider lifecycle fails closed

Providers register during negotiation, bind observations to a session epoch and
committed revision, and are validated before their capabilities enter the
contract. Conflicting providers, stale evidence, invalid recipients, impossible
regions, or disagreement with a declared hit-test are provider violations.

Disconnect after negotiation marks the provider lost, invalidates new planning,
wakes waiters, and raises a typed provider-lost error. The previous checkpoint
remains available only as trace/history evidence; the API never silently
downgrades.

## ADR-25 — Actions use one atomic committed frame

A Checkpoint identifies session, epoch, contract, sequence, screen revision, and
its paired semantic revision. Query resolution and every item of evidence used
by an ActionPlan come from one immutable ObservationFrame.

Immediately before its first PTY write, the executor performs a compare-and-swap
style checkpoint validation. If rendering advanced, it discards the plan and
re-resolves without sending input. Drag endpoints and spatial relations are
resolved together, never through two current-state reads.

## ADR-26 — Semantic and screen queries are separate domains

`getByText()` always queries the semantic tree. `getByScreenText()` always
queries terminal cells and owns physical occurrence/style options. Absence of a
semantic integration is a typed capability error; it never causes a grid
fallback.

Locator composition is a lazy immutable query AST. Operators preserve order and
operand scope, require the same session and query domain, and evaluate against
one ObservationFrame. An explicit qualified physical projection is the only
bridge between domains.

## ADR-27 — One serializable action model crosses every surface

ActionIntent, Condition, ActionPlan, device operations, and ActionReceipt are the
shared vocabulary of the TypeScript API, MCP, Recorder, Runner, and traces. A
receipt preserves the before checkpoint, actual transmitted operations, partial
failure/release behavior, and resulting checkpoint.

Surface-specific schemas and display models are generated or validated against
that vocabulary. Unknown action kinds fail closed rather than being ignored.

## ADR-28 — Injection strategies are framework-specific and certified

There is no universal best injection mechanism. Textual uses deterministic
Python startup injection and explicitly diagnoses `-S`/`-E` bypasses. OpenTUI
and Ink use exact-version Node/Bun instrumentation at audited render boundaries.
tview and Bubble Tea use checksummed Go source replacement. Ratatui uses audited
Cargo patching and explicit annotation render boundaries.

Every strategy is dormant without an active Termwright session. Where semantics
are required and the certified hook cannot attach, startup fails with a typed
probe-attach error; it does not fall back to generic semantics. Byte-parity and
real-process conformance tests protect ordinary application behavior.
