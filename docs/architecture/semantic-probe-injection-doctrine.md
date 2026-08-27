# Semantic probe injection doctrine

Termwright treats framework attachment as a capability-by-capability design
decision. The framework name does not determine the intervention level: one
adapter can combine public observation, an add-only reader and a narrowly
scoped control-flow hook.

This policy protects semantic fidelity and causal frame publication. Reducing
the number of patched files is valuable only when the replacement observes the
same facts at the same lifecycle boundary.

## Intervention tiers

| Tier | Mechanism | Verification | Binding |
|---|---|---|---|
| T0 | Public framework or runtime hook | behavioral conformance | detected capability |
| T1 | Add-only compilation unit in an upstream package namespace | owned-source digest, compiler and conformance | detected capability |
| T2 | Idempotent append-only declaration | owned-source digest, append idempotency, compiler and conformance | detected capability |
| T3 | Existing control flow or source bytes are changed, or a private runtime control-flow seam is wrapped | exact byte profile for source mutation; structural capability checks plus behavioral conformance for runtime-only wrapping | exact artifact when bytes are changed; detected runtime contract otherwise |

`sourcePatching` is reported separately from the tier. Textual, for example,
uses no source transform but wraps private display and writer lifecycle; that
is a T3 integration contract with `sourcePatching: false`, not T0.

T1 can expose state but cannot cause existing upstream code to call the probe.
If a requirement is “run after this flush”, it is T0 when a suitable hook
exists and T3 otherwise. AST instrumentation which inserts such a call is T3;
structural matching improves a T3 transform but does not turn it into T2.

## Required properties

Every capability must satisfy these rules:

1. A disabled probe is inert. It opens no socket, starts no worker and performs
   no semantic traversal.
2. Author opt-in is at most one attach call. Per-widget annotations may enrich
   names or roles but may not be required to discover structure.
3. Geometry is captured only after the framework computed layout for the
   corresponding frame.
4. The adapter builds the snapshot at the framework's consistent render
   boundary, but never performs transport I/O or re-enters the render loop
   there. Complete, pre-encoded snapshot/commit pairs enter one bounded,
   ordered, non-blocking publication queue. A full queue refuses the revision
   before it receives a marker or revision number; no marker escapes for that
   frame. Because the visual frame has already rendered, every framework
   adapter then closes semantic publication with a typed failure. Continuing
   with the previous tree would silently pair stale semantics with the newer
   terminal. Worker failure likewise closes semantic publication permanently.
   Slow transport is never hidden with sleeps, quiet windows, retries or
   larger timeouts.
5. Semantic provenance travels over the authenticated probe channel, never
   through terminal hyperlinks or another lossy visual encoding.
6. An unavailable subtree or lifecycle seam is reported as a named degraded
   capability. It is never silently omitted.
7. Node identity is session-local and stable only to the degree the framework
   provides evidence for it.
8. Build-time T1/T2/T3 instrumentation is offered only when Termwright controls
   the build. A supplied binary runs as raw PTY with that fact in run metadata.
9. A render marker is written through the exact sink which accepted the frame.
   Process `stdout` is not a valid fallback for a custom or stderr backend.

First-party probes record the concrete result in
`ProbeInfo.instrumentation`: `highestTier`, semantic class `A`/`B`, and the
closed list of named degraded capabilities. That list includes both broad
session capabilities and narrower probe facts such as inactive-screen
enumeration, so a limitation can be machine-visible without disabling the
otherwise authoritative live tree. The driver validates and
deep-freezes that declaration, then projects it into the effective session
contract. Custom and older protocol-v2 adapters may omit the additive field;
they are never presented as if they had made a doctrine declaration. An
uninstrumented/raw PTY remains explicit as `framework: null` with only the
terminal evidence provider, rather than acquiring fabricated probe metadata.

## Go add-only units

An add-only Go unit is T1 whether it is compiled from a build-owned pristine
copy or supplied by an official compiler hook. The important properties are
that no existing upstream file changes, Termwright's source has an owned
digest, and private-field drift fails compilation.

`go -overlay` is not a general dependency injection seam. It can add a target
for a local replacement and a vendored package, but the Go toolchain rejects a
target beneath an ordinary `GOMODCACHE` with “Files beneath GOMODCACHE must not
be replaced.” A local-only fixture is therefore insufficient evidence for a
production overlay design. Termwright must either use a build-owned pristine
copy or prove an official toolchain hook such as `-toolexec` against a real
module-cache dependency. It must never select overlay only for the cases where
it happens to work and silently use another intervention for the rest.

## Verified framework decisions

| Framework/capability | Mechanism | Tier | Source patching? | Reason and remaining risk |
|---|---|---:|---:|---|
| OpenTUI semantic render observation | runtime renderer and hit-grid observation | T0 | no | Public runtime state preserves geometry, clipping, ordering and hit targets. |
| OpenTUI native output evidence | structural constructor/output transform | T3 | yes | Public lifecycle does not prove successful same-writer byte delivery. Constructor transport shape remains coupled. |
| Ink committed host tree | preload/module interception plus exact renderer instrumentation | T3 | yes | The public Ink lifecycle alone does not expose an arbitrary application's complete committed root with equivalent fidelity. The React commit bridge remains subject to differential proof before removal. |
| Textual DOM and geometry | public live App/Screen APIs | T0 | no | Tree, focus and geometry are runtime-observable. |
| Textual causal commit | private `_display`, concrete driver writer and `post_display_hook` composition | T3 | no | Writer identity and lifecycle remain private runtime coupling, checked structurally and behaviorally per frame. Queue capacity is capability-checked as positive and bounded, not pinned to an incidental value. |
| tview public containers and lifecycle contract | public getters, documented before/after-draw callbacks and the public `tcell.Screen` interface | T0 | no | Most traversal/state and the relevant lifecycle semantics are public. `afterDraw` alone is not a byte-commit barrier. |
| tview sealed state and lock-safe hook installation | add-only package unit | T1 | no | Root, Grid, Modal and rendered private facts are compiler-checked. The unit installs and identity-checks `Application.beforeDraw`/`afterDraw` under the application lock; those phase gates arm only the final decorated `Show`, so intermediate flushes cannot publish partial semantics and runtime displacement fails closed. |
| tview Windows same-sink marker | add-only tcell package unit reached by the public screen decorator | T1 | no | Unix exposes the TTY writer publicly; the Windows unit exposes only the concrete active console writer. Missing private capability is a compile/conformance failure, not a source-profile fallback. |
| Bubbles sealed component state | add-only package units | T1 | no | Private state readers compile in the component packages; no Bubbles control flow is edited. |
| Bubble Tea live model and renderer commit | exact model-capture/post-flush hooks plus bounded Go publication worker | T3 | yes | Lip Gloss v2 retains compositor state, but Bubble Tea receives only flattened `View.Content`; no reachable compositor handle or public automatic invocation seam survives. The flush hook performs no semantic socket I/O. |
| Ratatui render calls | exact `Frame`/widget render hooks | T3 | yes | Immediate-mode identity and `Rect` exist only while calls execute. Backend cells have already lost ownership. |
| Ratatui list state | exact post-render list hook | T3 | yes | The hook reads private items and the selected/clamped offset after rendering; an appended getter cannot preserve that timing. |
| Ratatui causal commit | exact constructor/terminal/backend integration plus bounded Rust publication worker | T3 | yes | `Terminal::with_options` completes the handshake before the render loop and installs a clone-aware lifecycle guard. A per-thread nested frame stack avoids re-entrant corruption; an atomic non-blocking permit spans publication through the same-writer marker. Concurrent terminals keep rendering but close semantics immediately after the active marker, while both terminals remain alive. Final `Terminal` drop drains the worker. Unsupported custom backends fail closed rather than writing to stdout. |

Charm v1 remains a tree-without-bounds integration unless a separate,
explicitly degraded annotation capability is designed. OSC 8 is not a semantic
transport: it collides with application hyperlinks and is not a portable
provenance channel.

## Release refactor summary

| Framework | Previous mechanism | Release mechanism | Source patching remains? | Why and remaining maintenance risk |
|---|---|---|---:|---|
| OpenTUI | exact generated-chunk discovery, source needles and SHA profiles | public renderer/hit-grid/frame observation plus a narrow structural native-output transform | yes, output only | Runtime parity removed semantic chunk coupling. Native byte-delivery/error evidence is not public; constructor transport shape remains T3 debt. |
| Ink | preload/module interception plus exact `ink.js`/`renderer.js` transforms | same exact path, isolated from an experimental composable React commit bridge | yes | Differential tests found resize without commit, `<Static>`, root/unmount and causal flush gaps. Removing the patch would reduce fidelity. |
| Textual | startup hook plus exact version allowlist | startup/runtime hooks admitted by structural capabilities and behavioral conformance | no | DOM is public T0; private display/writer lifecycle is runtime-only T3 and may drift, but no installed file or version profile is patched. |
| tview/tcell | exact copied modules, `go.work`, source patch and tcell AST/SHA profiles | public `Screen` decorator plus T1 units added by `-toolexec` | no | Private fields and the Windows console handle are compiler-checked. Native Windows conformance and upstream private-symbol drift remain the risks. |
| Bubble Tea | exact copied module with model/renderer control-flow patches | smaller exact T3 model/flush patches with atomic non-blocking admission | yes | A live model and post-flush same-writer boundary are not publicly reachable. Every new Bubble Tea version still needs exact review. |
| Bubbles | exact-version add-only manifests coupled to the copy path | schema-v2 T1 owned units compiled directly with `-toolexec` | no | Private state drift becomes a loud compile failure; behavioral breadth still needs candidate conformance. |
| Ratatui | exact core/widgets instrumentation | exact render, post-render list-state and concrete backend commit hooks with nested TLS frames and atomic admission | yes | Immediate-mode identity/state exists only in control flow. List T2 was rejected because final offset/state mutates during render; backend output cannot reconstruct it. |

The table records the achieved lowest faithful tier, not an aspiration to make
all rows look alike. T3 debt is expected to decrease only when a replacement
passes differential conformance.

## Certification and reporting

The compatibility registry records interventions per capability, including
tier, `sourcePatching`, required symbols, owned added units, degradation class
and conformance suite. It also reports the number of T3 interventions per
framework as tracked maintenance debt.

T0/T1/T2 admission is capability- and behavior-based. Advisory version ranges
may guide discovery but do not override capability checks. T3 stays exact,
fail-closed and content-addressed wherever source is transformed. A runtime-only
T3 hook, such as Textual's private display lifecycle, has no transformed bytes
to authenticate; it is admitted only when its concrete structure and behavior
pass the same fail-closed conformance contract. A successful compile is
necessary for T1/T2 but never substitutes for semantic and causal conformance.

No intervention is demoted merely because a new implementation compiles. The
old and new paths run differentially until tree facts, identity, geometry,
state, lifecycle revisions and terminal ordering agree. Only then is obsolete
machinery removed; there is no legacy fallback.
