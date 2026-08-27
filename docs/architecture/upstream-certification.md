# Upstream framework certification

The intervention tiers and cross-framework invariants used by this process are
defined in [Semantic probe injection doctrine](semantic-probe-injection-doctrine.md).
This document covers candidate admission and exact artifact certification; the
doctrine decides whether a capability should use that exact T3 machinery at
all.

This document defines how Termwright should admit a new upstream framework
version without confusing "a patch was produced" with "the adapter is safe to
ship". It covers both runtime-hook adapters and adapters that require an
instrumented source copy.

The sections labelled **Current** describe code and workflows in this
repository today. Sections labelled **Target** are a design for future work.
The repository now has daily release discovery, bounded candidate
certification, trusted artifact reconciliation, an idempotent candidate-PR
opener, and a coordinator that merges an exact-SHA green candidate before the
ordinary exact-SHA release path. It still has no general AST recipe engine,
manifest v2 writer, signed canary/revocation service, or automatic upstream
patch publisher. Discovery never makes a framework version supported by
itself; the reviewed compatibility ledger remains authoritative.

The automation is an integrity and compatibility boundary, not a hostile-code
sandbox. Checksum-bound upstream packages run only in ephemeral jobs without
write credentials; trusted aggregation prevents stale, partial,
cross-candidate, and candidate-produced update artifacts from entering a PR.
It does not claim containment if an upstream package intentionally attacks the
same-UID hosted runner. Adversarial upstream execution requires a separately
sandboxed certification environment and is outside automatic support
promotion's threat model.

## Policy

1. Prefer an additive, public runtime observation hook when the runtime can
   inject it before the application imports the framework.
2. When only sealed state is missing, add an owned compilation unit and let the
   compiler verify it (T1), or use an idempotent append-only declaration (T2).
   Edit existing control flow (T3) only when T0–T2 cannot express the required
   causal observation.
3. Bind source-mutating T3 integrations to an immutable exact artifact. Admit
   T0/T1/T2 and runtime-only T3 integrations through detected capabilities plus
   behavioral conformance; version ranges remain advisory.
4. Refuse on an unknown or ambiguous structural anchor. Never fall back from an
   AST recipe to a fuzzy textual edit.
5. Automation may open a candidate PR and publish a signed canary only after
   behavioral certification. Stable support always requires a human promotion.
6. A capability change is a contract change. It is never approved by the
   generator merely because the code still compiles.

The central distinction is between two seams:

- The **observation seam** is where a complete, current framework tree or model
  can be read at the correct point in the render/flush cycle.
- The **injection seam** gets Termwright code into an application that imports
  nothing of ours.

Ink, OpenTUI and Textual have both seams at runtime. Go and Rust applications
are statically linked; Termwright must control their build for T1/T2/T3 and a
prebuilt binary remains explicitly raw PTY. The supported author seam is at
most one attach call; framework-specific wrappers and per-widget construction
changes are not required for structure.

## Framework decisions

| Framework        | Current strategy                                                                                                                                                                                                                          | Why it is the right default                                                                                                                                                                                                                                                                                                | Version-sensitive surface                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ink              | Runtime module preload shims the ordinary `ink` export, while exact-certified transforms instrument `renderer.js` and `ink.js`                                                                                                            | Node and Bun provide a stable interception seam, but `onRender`, `measureElement()` and `useBoxMetrics()` require an application-owned node and cannot expose an arbitrary application's complete committed host/layout tree                                                                                               | Both transformed artifacts must match one exact profile listed in the compatibility registry or the adapter fails closed. The runtime interception layer is stable; the source transforms and retained host-tree fields remain version-specific                                                                                                                               |
| OpenTUI          | Runtime module preload wraps public `createCliRenderer`; runtime observation captures geometry, while a narrow AST transform preserves the native stdout feed and same-writer commit queue                                                | The live renderer exposes the render pass, clipping, hit grid and frame boundary. Public hooks do not expose successful native byte delivery, so transport alone remains structurally instrumented                                                                                                                         | `renderList`, `renderOffset` and constructor transport shape are version-sensitive. Admission is capability- and behavior-based; no chunk name, exact source fragment, source SHA or bundle digest participates                                                                                                                                                               |
| Textual          | Ephemeral `sitecustomize.py` wraps the display path, concrete built-in driver write and `post_display_hook`                                                                                                                               | CPython provides the injection seam. The wrapper proves that frame bytes entered the built-in WriterThread FIFO, then appends the marker non-blockingly to that same FIFO; no installed Textual file is copied or edited                                                                                                   | `_display`, built-in driver/WriterThread identity and `post_display_hook` remain private T3 runtime coupling. Their live structure and FIFO behavior are checked per frame; DOM geometry and hit-test APIs are checked when observed. There is no version allowlist; inline and custom drivers fail closed                                                                    |
| tview            | One public `Attach` call plus T1 compiler units added through `-toolexec`; the tview unit composes the public hook contract under the application lock and arms only the framework's final call through a public `tcell.Screen` decorator | Public APIs expose most traversal and the output boundary. Intermediate custom/hook `Show` calls remain visual-only; T1 reads sealed root/container and hook identity state, while Windows receives a T1 same-console marker writer. No upstream byte is edited or copied                                                  | Private fields remain compile-time coupling and native Windows delivery remains a behavioral requirement. Candidate admission compiles and runs conformance on Linux+Windows rather than generating source profiles                                                                                                                                                           |
| Bubble Tea v1/v2 | Ephemeral `go.work` redirects the exact module to a checksummed copy                                                                                                                                                                      | Renderer methods receive a flattened view, not the live model. Model-aware hooks stage semantic state, while exact renderer-flush hooks commit only after terminal bytes reach the same writer. Non-blocking admission defers a contending flush before output and fails semantics closed rather than blocking or guessing | v1.3.10 has three `tea.go` capture anchors plus `standard_renderer.go`; v2.0.8 and v2.0.9 have exact `Program.render` plus `cursed_renderer.flush` profiles. All also patch `go.mod`; current patch-set version 21                                                                                                                                                            |
| Bubbles v1/v2    | Exact import-path `-toolexec` injects add-only compiler units into the selected package namespace                                                                                                                                         | Public getters do not expose all rendered state, but the missing accessors compile in the upstream package without editing or copying it. The owned profile is selected by module line and preflight-compiled against the resolved candidate; its version is advisory                                                      | Private field names and types still matter and must compile. The Charm integration uses GOMODCACHE because its separate Bubble Tea T3 workspace path rejects vendor mode; the generic T1 seam is vendor-capable. The wrapper identity binds every owned source digest and every injected import archive into Go's build cache while excluding temporary materialisation paths |
| Ratatui          | Cargo `--config patch.crates-io` redirects `ratatui-core`, `ratatui-widgets` and, when present, `ratatui-crossterm` to checksummed copies                                                                                                 | Immediate-mode render calls and concrete post-render list state require control-flow hooks. The marker is supported only when the concrete backend can append to the same writer that carried the frame                                                                                                                    | Ratatui 0.30.2 resolves to `ratatui-core` 0.1.2, `ratatui-widgets` 0.3.2 and normally `ratatui-crossterm` 0.1.2. A custom/TestBackend fails semantic publication rather than guessing stdout. `std`/`no_std`, features and MSRV remain part of the contract                                                                                                                   |
| Lip Gloss        | No independent probe patch                                                                                                                                                                                                                | Bubble Tea sees the final styled string. The audited v2 compositor and OSC 8 channels could preserve geometry provenance, but neither is wired today                                                                                                                                                                       | No bounds capability may be claimed until a channel is implemented and behaviorally certified                                                                                                                                                                                                                                                                                 |

### Refactor outcome

| Framework        | New mechanism                                                                                                                                                                                                                                  |    Source patching remaining? | Why                                                                                                                                                                                                                                  | Remaining maintenance risk                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenTUI          | Module preload wraps `createCliRenderer`; runtime wrappers observe root/render-list/buffer/hit-grid and `FRAME`. A fail-closed constructor AST transform retains NativeSpanFeed ordering/error evidence while restoring public stdout identity | Yes — structural, output-only | Runtime APIs provide full semantic geometry, but not causal/error-aware native byte delivery. Removing the feed transform would permit a marker after a swallowed frame failure                                                      | Constructor transport shape, unpublished `renderList` and split-footer offset remain version-sensitive. Candidate admission runs behavioral conformance on Linux and macOS; there are no chunk/SHA profiles |
| Ink              | Stable Node/Bun module interception plus exact-certified `renderer.js` and `ink.js` transforms                                                                                                                                                 |                           Yes | Public `onRender`, `measureElement()` and `useBoxMetrics()` cannot expose the complete committed host/layout tree of an arbitrary zero-config application                                                                            | Two exact upstream artifacts and their transform anchors must be reviewed for each candidate                                                                                                                |
| Textual          | `sitecustomize` installs runtime wrappers around the display attempt, concrete writer enqueue and `post_display_hook`; DOM/geometry are read through framework APIs                                                                            |                            No | Python startup injection and the live App/Driver objects provide the observation and injection seams without editing installed files                                                                                                 | Commit-boundary internals and concrete writer classes remain T3 debt, but admission is capability- and behavior-based rather than version-based; unsupported/custom drivers fail closed                     |
| Bubble Tea v1/v2 | Exact checksummed model-capture and renderer-flush patches in disposable module copies                                                                                                                                                         |                           Yes | The renderer receives a flattened view, while the live model is required for semantics; Go has no zero-config runtime module hook                                                                                                    | Each version needs a manual model/flush/error-order audit and exact before/after hashes                                                                                                                     |
| Bubbles v1/v2    | Add-only accessor units through one content-bound `-toolexec` compiler wrapper                                                                                                                                                                 |                            No | Public getters omit state that affects the rendered frame; an added package unit can read it without editing or copying an upstream byte                                                                                             | Private field/type drift becomes a loud compile failure and behavioral conformance remains required. Controlled build/test commands must carry the explicit `-toolexec` argument                            |
| tview/tcell      | Public one-line attach, chained before/after-draw phase gate and `Screen` decorator plus add-only tview/tcell compiler units selected by import path                                                                                           |                            No | The phase gate publishes only tview's final framework `Show`; intermediate custom/hook flushes cannot authorize partial semantics. T1 units expose sealed state and the Windows console writer without editing upstream control flow | Private symbols can break compilation; hook displacement, re-entrant/concurrent screens and native Windows same-writer delivery remain required behavioral gates                                            |
| Ratatui          | Exact checksummed `Frame::render_widget*`/widget-state instrumentation plus a certified `CrosstermBackend` same-writer marker capability                                                                                                       |                           Yes | Immediate-mode widget identity, type, `Rect` and post-render state exist only inside control flow. Output-level interception cannot recover them, and a process-stdout marker cannot certify an arbitrary backend sink               | Core/widget call sites, concrete private list state, the Crossterm writer, feature/MSRV/no_std variants and flush ordering remain exact-version maintenance surfaces                                        |

Runtime attachment is not inherently safer than copy-and-patch. It avoids
source-byte anchors, but an internal object field can disappear just as easily.
Runtime adapters therefore need capability detection, behavioral certification
and negative tests; runtime-private coupling remains explicit T3 debt even
without a byte profile. Their failure mode remains fail-open for
the application and fail-closed for semantics: if required shapes are absent,
decline to attach or withhold the affected capability rather than guess.

### Why the remaining Bubble Tea patches stay exact in 0.3

The remaining Bubble Tea call sites are structurally identifiable, but
replacing their exact control-flow hunks with a package-local AST transformer
would not yet reduce
maintenance risk. Keeping raw source SHA checks around such a transformer
would still reject formatting-only drift. Accepting that drift safely requires
a shared manifest-v2 contract with canonical typed before/after digests,
zero-or-multiple-match rejection, module-aware type loading, and identical
execution in the launcher, patch tests and candidate certifier across every
certified `GOOS`/build-tag variant. Without that shared contract an AST path
would create a second, non-equivalent certification system while every new
upstream version would still need a manual flush/error/lock-order audit.

Therefore Bubble Tea retains its exact-version, before/after-hashed T3 patches
for 0.3. tview no longer participates in this machinery. There is no fuzzy
matching. Structural instrumentation should be revisited only as the shared
certification contract described below, not as a launcher-only transform.

### What public upstream hooks would change

The long-term route away from source edits is to upstream additive, read-only
observation APIs:

- **tview:** public container accessors would remove the remaining T1 private
  state readers. The current public `Screen` interface already provides the
  causal output boundary through transparent decoration.
- **Bubble Tea:** an additive frame observer that receives the live model and
  the exact rendered `View` for initial, update and final frames, with an
  explicit flush/commit ordering contract.
- **Bubbles:** public getters for the state actually drawn: animation frame,
  rendered progress, highlighted index/count and rendered windows. Those would
  remove the add-only copies.
- **Ratatui:** additive render-call and post-backend-flush observers, preserving
  `no_std` when no observer implementation is linked, plus public inspection of
  concrete widget state where the core trait erases it.

These hooks would let an application opt in without carrying a fork and would
make a Termwright-maintained copy much smaller. They would not, by themselves,
make zero-config runtime injection possible in Go or Rust.

## Current patch-set contract

The Go manifests consumed by `@termwright/probe-go` and the Rust manifests
consumed by `termwright-probe-ratatui` currently carry:

- framework/module and exact version;
- `patchSetVersion`;
- for edited files, `sha256Before`, a unified diff, and `sha256After`;
- for added files, source path and SHA-256;
- optional dependency requirements and an explanatory note.

Before hashes refuse the wrong source before an edit. After hashes catch a diff
that applied cleanly but produced unexpected bytes. The patch-set digest feeds
the materialized-copy cache key; Ratatui additionally keys and rechecks its
cache with the complete source-tree digest and build inputs.

The add-only Bubbles manifests have `patched: []`. They checksum the five
compiler units Termwright injects, and the composed `-toolexec` identity binds
their complete configuration into Go's build cache, but no upstream Bubbles
file. Exact version detection and compilation are therefore the guards against
private-field drift, not a cryptographic binding to the upstream source tree. Manifest v2's registry
artifact and complete-tree digests are required to make that binding part of a
self-contained patch-set contract. The bounded certifier below supplies the
binding in its candidate evidence, but today's manifest alone does not.

This is intentionally fail-closed, but it is not yet a certification system.
The manifests have no schema version, canonical recipe, upstream registry
artifact digest, generator identity, full output-tree digest, capability diff,
test-evidence reference, signature, or revocation status. The committed unified
diffs are inputs to the current appliers; no repository workflow regenerates
them from a structural recipe when a new upstream release appears.

## Current bounded candidate certifier

`scripts/certify-upstream-patches.mjs` implements a fail-closed local profile
for the committed Go and Rust patch sets. It:

- discovers the package-owned manifests and requires an exact matching module,
  version, patch-set version, identity kind and capability declaration in
  `compatibility/registry.json`;
- validates normalized paths, unique targets, digest shapes, non-empty patch
  files and every added-file hash before invoking a toolchain;
- resolves each exact Go module through `go mod download` in a fresh isolated
  module cache with `sum.golang.org` required (and private/no-sum bypasses
  cleared), so the Go checksum database authenticates the archive used to
  create the input tree; it records the `h1`, `go.mod` sum, module zip SHA-256
  and source-tree digest. Rust packages must be crates.io sources; the
  certifier hashes the cached `.crate` against the pinned Cargo lockfile
  checksum and patches a fresh extraction of that archive rather than the
  mutable Cargo source cache;
- applies each patch set twice in clean directories. Go uses the existing
  `@termwright/probe-go` materializer/applier. Rust uses
  `clients/rust-probe/examples/upstream_certify.rs`, a thin executable over the
  existing Rust `copy_out`, `apply` and `digest_patch_set` functions;
- compares the two complete output-tree digests and therefore also closes the
  current add-only Bubbles source-binding gap at candidate time;
- by default runs the compatibility registry/runtime drift gate plus the
  existing probe-go, tview, Charm and Ratatui test suites;
- records the actual Node, pnpm and selected ecosystem toolchain versions used
  by the runner, without claiming that the runner is hermetic;
- emits canonical `candidate-report.json` plus, on success only, an unsigned
  in-toto-shaped `candidate-provenance.json`. The provenance records the
  compatibility gate among its verification suites and binds each committed
  patch-set, registry archive and freshly extracted source-tree digest as a
  resolved dependency.

The report has `state: "candidate"` and a profile-local `candidateStage` of
`generated` (when explicitly run with `--skip-existing-tests`) or `buildable`.
It also states `targetCertificationState: "not-assessed"`,
`behaviorallyCertified: false` and `stablePublishEligible: false`. These local
stage names are evidence about the bounded v1 profile, not claims that the full
target state machine below has passed.

`.github/workflows/upstream-candidates.yml` is the trusted daily candidate
pipeline, not a wrapper around this local profile. Discovery computes a bounded
oldest-first matrix from registry catalogs and the default-branch certification
ledger; manual dispatch may further select one exact stream. Each matrix job
initializes a revision-, digest- and host-platform-bound red verdict before
toolchain setup, then performs the integration-specific exact-source or runtime
behavioral certification. OpenTUI requires Linux and macOS results; tview/tcell
requires Linux and native Windows/ConPTY results. The trusted aggregate accepts
only the complete required platform set with exact artifact shape and matching
executable resolution, and generates a checksummed update only for conjunctive
green candidates.

Raw platform artifacts are deliberately outside the namespace consumed by the
reconciler. Only the aggregate verdict and trusted generated bundle are exposed
to `autonomous-coordinator.yml`, which reproduces reconciliation from the
default-branch SHA, opens or updates the bounded compatibility PR, verifies its
exact tree and first-attempt CI, and only then may merge it. Red candidates
update a digest-keyed issue/assessment; pre-verdict infrastructure failures use
the dead-man issue path. Candidate jobs remain read-only and cannot themselves
push, open a PR, tag or publish. Checkout failure, runner loss, timeout or
cancellation may still prevent a raw artifact, which therefore becomes an
explicit aggregate/coordinator failure rather than an invented verdict.

After building the workspace packages, the local entry point is:

```sh
node scripts/certify-upstream-patches.mjs --output upstream-candidate
```

`--ecosystem go` and `--ecosystem rust` bound a run to one toolchain.
`--skip-existing-tests` is diagnostic only: it leaves `candidateStage` at
`generated` and cannot produce a buildable local candidate.

## Target state machine

Certification state is monotonic for one immutable candidate. Promotion and
revocation are separate dimensions.

| State                    | Meaning                                                                                                                                                                                                                                                 | What it does **not** mean                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `generated`              | The exact upstream artifact was authenticated; a closed recipe resolved every structural selector exactly once; two local runs and two independent runners produced the same canonical output tree; the allowlisted diff and manifest v2 were generated | The patched framework compiles or runs                                                       |
| `buildable`              | `generated`, plus pristine and instrumented source pass the required build/test matrix for the ecosystem, including supported features, MSRV and `no_std` where applicable                                                                              | The probe observes the right frame, preserves terminal bytes, or reports honest capabilities |
| `behaviorally-certified` | `buildable`, plus active and dormant real-process/PTY suites, protocol conformance, failure/backpressure cases and manual capability review all pass                                                                                                    | Stable publication; it is only eligible for a signed canary and human promotion              |

For a runtime-hook adapter, `generated` produces no patched tree. It means the
candidate record pins the upstream package artifact, resolves the expected
exports/classes/attributes without ambiguity, and produces a deterministic
runtime attachment plan. The buildable and behavioral gates are otherwise the
same.

A failure never downgrades to the previous state. The candidate retains its
evidence and the failed gate, but is ineligible for distribution. A changed
recipe, template, generator, upstream artifact or capability set creates a new
candidate identity and starts again at `generated`.

## Target deterministic recipes

Recipes should be declarative TOML parsed into a closed recipe AST. They are
not shell scripts and may not contain arbitrary code. A future layout is:

```text
tools/upstream-certification/
  recipes/
    tview.toml
    bubbletea-v1.toml
    bubbletea-v2.toml
    bubbles-v1.toml
    bubbles-v2.toml
    ratatui-core.toml
    ratatui-widgets.toml
  schema/
    recipe.schema.json
    manifest-v2.schema.json
  go/        # go/parser, go/types and x/mod/modfile executor
  rust/      # syn and toml_edit executor
  orchestrate.mjs
```

This layout is proposed; none of these files exists today.

A recipe identifies the ecosystem/module, admissible upstream release line,
immutable artifact source, required toolchain, templates and an ordered list of
transforms. Each transform has:

- an ID stable across upstream releases;
- a file allowlist and operation kind (`insert-call`, `replace-expression`,
  `edit-dependency`, or `add-file`);
- a structural selector including package/module, enclosing type/function,
  call or field shape, and relevant type constraints;
- `expectedMatches = 1` (or an explicit exact count such as Bubble Tea v1's
  three independently named frame sites);
- preconditions and postconditions;
- a content-addressed template;
- declared capabilities it enables or affects.

Go source transforms use `go/parser` and `go/types`; `go.mod` edits use
`golang.org/x/mod/modfile`. Rust source transforms use `syn`; Cargo manifest
edits use `toml_edit`. AST selection must happen before any bytes are written.
The executor may perform a span-bounded edit to preserve unrelated formatting,
then reparses and type-checks the complete result. Formatter and parser
versions are pinned and recorded. Regex, line number and "nearest similar
call" are not fallback selectors.

Bubbles remains add-only, but its recipe still type-checks the exact private
fields and method signatures used by each accessor. "No upstream file edited"
removes diff-context drift; it does not prove a new release retained the fields'
meaning.

Machine-local bindings, such as the path to `termwright-probe-ratatui`, are a
separate declared materialization transform. The certified tree contains a
canonical placeholder. A launcher may substitute only that field and must
recheck every other digest; local paths must never leak into a published
manifest or make generation nondeterministic.

### Mandatory refusal tests

Every recipe ships mutations that prove it can fail:

- remove the intended anchor;
- duplicate it or add a structurally plausible decoy;
- change the enclosing function/type or the selected expression's type;
- rename or change the type of a private field used by an added accessor;
- provide the wrong module path, major version or artifact digest;
- modify an unallowlisted file;
- tamper with a template, generated file or expected after digest;
- reapply to an already transformed tree.

Zero matches, too many matches, a failed type check or an unexpected diff must
leave the candidate tree untouched and produce a named refusal. A mutation
test that merely makes the downstream compiler fail is too late: it must prove
the selector itself rejects ambiguity.

## Target manifest v2 and provenance

Manifest v2 remains JSON so launchers can consume it beside today's manifests,
but is canonicalized before hashing. It records enough information to
reproduce and audit a candidate without trusting a PR description:

- `schemaVersion: 2`, framework/module identity, ecosystem, exact upstream
  version and `patchSetVersion`;
- upstream registry URL, immutable artifact digest, Go `h1`/`go.sum` identity
  or crates.io checksum where applicable, and canonical pristine tree digest;
- recipe ID/version/digest and every ordered transform ID;
- generator source commit, generator binary/container digest, parser,
  formatter, toolchain and template digests;
- every edited/added file with before/after digest, plus the canonical complete
  output-tree digest;
- declared local materialization bindings and their permitted fields;
- probe and adapter capability sets, and the reviewed capability diff from the
  previous stable certification;
- test matrix/evidence digest, SBOM digest and an external provenance
  attestation reference;
- candidate channel, promotion record, and revocation-ledger epoch.

The manifest does not sign itself. A DSSE envelope carries an in-toto/SLSA
provenance statement whose subjects include the canonical manifest, recipe,
upstream artifact and output-tree digests. Candidate artifacts, SBOM (SPDX or
CycloneDX) and provenance are signed with keyless Sigstore/cosign identity and
stored together. Verification pins the repository/workflow identity, not just
"a valid public signature". Existing npm trusted-publishing provenance is
useful release provenance, but it is not this upstream-transform attestation.

## Target certification gates

All required gates must report `pass`; an unavailable toolchain or PTY is a
failure in certification, not a skip. Platform-inapplicable rows are declared
in the recipe and reviewed rather than discovered by skipping a test.

### 1. Source identity and isolation

- Fetch from the ecosystem registry using an exact version. Verify npm/PyPI
  artifact integrity for runtime adapters, Go module `h1` identity and
  `go.sum`, and crates.io package checksum for Rust.
- Build the canonical tree digest from sorted relative paths, file modes and
  blob hashes; ignore timestamps and extraction directory names.
- Refuse mutable tags, Git/path replacements and ambiguous multi-version graphs
  unless a recipe explicitly models them. Never generate from the user's
  module cache without first matching the registry identity.
- Run generation without repository credentials and with network access closed
  after the artifact fetch.

### 2. Deterministic transform and diff

- Run twice in clean directories on one runner and once each on two independent
  runners. Manifest bytes, generated files, unified review diff and tree digest
  must match exactly.
- Require unique structural selectors, successful reparse/type-check and all
  mutation-negative tests.
- Compare the entire pristine and output trees. Only recipe-allowlisted files
  may change or be added; deletion, symlink, executable-bit and generated binary
  changes are refused unless explicitly modelled.
- Apply the emitted review patch through the current applier and recheck every
  per-file after hash and the complete tree digest.

### 3. Build and upstream regression matrix

- Build and test the pristine upstream artifact first, then the instrumented
  artifact under the same pinned environment. This separates an upstream test
  failure from a Termwright regression.
- Go: `go test ./...`, the race detector on supported targets, vet/type checks,
  both supported module majors, and cold-cache/workspace isolation.
- Rust: MSRV and stable builds, upstream tests, all supported feature
  combinations, default/no-default features, and explicit `no_std` checks for
  `ratatui-core` and `ratatui-widgets`. Confirm the probe dependency is absent
  from the `no_std` graph.
- Runtime adapters: build/import under every declared Node/Bun/Python lane and
  against the exact framework artifact; missing hook shapes must produce a
  diagnostic and leave the application running.

### 4. Dormant and failure parity

- Compare two vanilla runs first and refuse a nondeterministic fixture.
- With injection armed but no complete handshake environment, terminal stdout,
  stderr, exit code and project files must be byte-identical to vanilla. No
  socket, marker, probe thread or retained registration may remain.
- With an unreachable, disconnecting or malformed driver, the application must
  still match vanilla apart from an out-of-band diagnostic explicitly allowed
  by the recipe.
- With an active probe, stripping authenticated Termwright markers must restore
  the vanilla terminal byte stream.

### 5. Active real-process/PTY behavior

Every framework fixture must exercise the claims it can make:

- initial, live-update and graceful-final frames;
- resize and geometry/clipping where bounds are claimed;
- focus, value, selection, collection, scroll and visibility state that the
  recognizer advertises;
- annotations merged without overriding probe-owned physical facts;
- frame publication followed by commit and a marker only after the frame bytes
  have drained;
- a slow/stalled driver, bounded render-hook latency, honest drop counters and
  full-snapshot recovery after producer-side loss;
- invalid or oversized framework data, teardown and application exceptions;
- protocol validation and the relevant subprocess adapter-conformance suite.

The absence of a framework concept is also asserted. For example, Charm must
not gain bounds from string parsing, Ink must not invent attributable focus,
and Ratatui must not promote frame-local render calls to stable identity.

### 6. Capability review and supply-chain evidence

- Diff probe capabilities, adapter capabilities, identity kind, recognized
  types and `unobservable` fields against the previous stable version.
- Require a human owner for every added, removed or weakened capability and for
  every new private field or hook dependency. "No diff" may be mechanically
  accepted inside the candidate PR, but does not bypass final promotion.
- Produce the manifest v2, test-evidence index, SBOM and signed in-toto/SLSA
  provenance. Verify all signatures again before canary publication and stable
  promotion.

## Candidate PR, canary and stable promotion

`upstream-candidates.yml` now discovers unverified registry releases daily,
binds every candidate to trusted ledger state, certifies a bounded matrix, and
uploads immutable verdict artifacts. `autonomous-coordinator.yml` runs with the
write boundary separated from untrusted candidate execution: it reconciles the
exact successful run, opens or updates the compatibility PR, requires its exact
SHA to pass the complete CI contract on the first attempt, then merges it. The
same coordinator sequences the Version PR and `release.yml`; publication is
bound to the reviewed, green SHA rather than a moving branch name.

This is stable-ledger automation, not a signed canary system. A future canary
stage must sign content-addressed evidence, never move `latest`, and require a
protected human promotion with re-verification of sources, capabilities and
revocations. `preview-release.yml` remains an ordinary PR-package preview and
does not publish upstream certification evidence.

Candidate PRs must show the upstream release identity, structural match report,
complete allowlisted diff, state transition evidence, capability diff, private
surface changes, licenses/SBOM and attestation verification command. Generated
files are review artifacts; the recipe and templates remain the source of
truth.

## Immutability, revocation and rollback

Once a patch set has appeared in a signed canary or stable release, its tuple
`(framework, frameworkVersion, patchSetVersion, manifestDigest)` is immutable.
A correction increments `patchSetVersion` and produces a new attestation. It
does not rewrite a tag, package version, manifest or cache entry in place.

A future `upstream-revocations.json` ledger should be canonical, monotonically
versioned and DSSE-signed. Each entry names the exact tuple and digest, reason,
severity, replacement (when known), and effective time. Launchers check the
bundled ledger before cache lookup and again before returning a materialized
copy. They may refresh a newer ledger only after signature and repository
identity verification; unsigned network data can never disable or enable a
patch.

Revocation behavior is fail-closed for semantics:

- refuse a revoked build with an actionable diagnostic;
- quarantine or invalidate matching materialized cache entries and include the
  ledger epoch in future cache keys;
- stop candidate/canary distribution immediately with a protected kill switch;
- leave the application runnable without Termwright instrumentation;
- roll forward to a new patch-set/probe release or, when safe, a previously
  certified non-revoked version. Never silently substitute a different
  framework version in the user's dependency graph.

Offline launchers enforce the newest valid ledger bundled or previously cached.
The stable package release remains the reliable way to distribute a new
revocation snapshot; a remote refresh shortens response time but is not a root
of trust.

## Existing evidence and remaining gap

The repository already has substantial pieces of the behavioral gate:

- `packages/probe-go/src/patch-manifest.test.ts` checks exact Bubble Tea manifest
  identity, stable patch-set digests, before/after refusal, CRLF determinism
  and real compilation. `toolexec.test.ts` contains only deterministic,
  process-free unit contracts. `scripts/certify-go-toolexec.mjs` owns the full
  real-toolchain contract outside Vitest's per-test budget: validation and
  collision refusal, ordinary and vendored builds, compiler identities,
  imported archives, warm-cache tamper refusal, and the internal `go test`
  package namespace. CI runs that fail-closed certification on Ubuntu, macOS
  and Windows under every supported Node major; release verification runs the
  same script after the production package build.
- `packages/probe-tview/src/zero-config.pty.test.ts` checks initial/live state,
  dynamic roots, resize, injection presence and dormant terminal byte parity.
  Go race tests cover bounded publication, marker discipline, re-entrant Show
  and concurrent applications.
- `packages/probe-charm/src/patch-sets.test.ts` compiles both Bubble Tea majors
  and both add-only Bubbles sets; `zero-config.pty.test.ts` exercises plain,
  annotated, secret-masking and private Bubbles state paths.
- `clients/rust-probe/tests/patchset.rs` checks exact inputs/outputs, `no_std`,
  a vanilla app reaching the probe, validated publication, annotations and list
  state. `tests/launch.rs` checks dependency resolution and lockfile restoration.
- Ink's `zero-config.test.ts`, OpenTUI's `zero-config.test.ts` and Textual's
  `test_probe_golden.py` assert real-process publication and terminal parity;
  Ink and OpenTUI session tests pin marker-after-drain ordering.
- The `CI` workflow has cross-platform package tests, a `conformance` job, an
  OpenTUI/Bun job, language-client jobs and separate Rust MSRV lanes. The
  OpenTUI lane probes its pinned Bun binary before executing the real probe
  package tests, while the Ratatui lane's required flag prevents either lane
  from looking green solely because its prerequisites were missing.
- The bounded candidate certifier now joins source identities, manifest
  inputs/outputs, compatibility declarations, two clean applications and the
  existing suites into one deterministic unsigned artifact for the committed
  static patch sets.

What remains missing is structural recipe generation, manifest v2,
independent-runner reproducibility, signed canary artifacts, formal capability
approval, and a signed revocation ledger. Candidate discovery, certification,
PR reconciliation and exact-SHA release coordination are implemented, but
promotion still relies on reviewed exact-byte patch sets and the protected
compatibility ledger.
