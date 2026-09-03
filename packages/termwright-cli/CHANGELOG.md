# termwright

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make `hostPressure: 'exclusive'` reserve the host's complete weighted capacity, and let already-active attempts acquire fitting continuation resources ahead of blocked new attempts. New attempts remain FIFO, while dynamic terminal acquisition can no longer deadlock behind a waiter that needs the active attempt's resources.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace misleading generic owned-process RSS/count fields with capability-qualified whole-tree accounting. Windows sessions now capture cumulative Job Object CPU, memory, process, and I/O counters before disposal; run manifest v8 preserves their native meanings and reports unsupported platforms as unavailable.

### Patch Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Physically isolate Termwright's certified Vitest 4 engine from a consumer's Vitest installation, including npm 10 installs alongside Vitest 5. Make `termwright doctor` inspect that embedded engine, and keep Gherkin definitions coupled only to Termwright's public test API.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep POSIX shell command tracking authoritative when an interactive shell enables `errexit`, so failed commands still emit their completion boundary and return an exit status instead of timing out. Generic terminal resize receipts no longer misclassify arbitrary later PTY bytes as proof of an application repaint; paired render evidence is reported only when a semantic adapter can prove it.
- Updated dependencies [[`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`3d0d95f`](https://github.com/Gorce-AI/termwright/commit/3d0d95ff3980bb8d656bcad2c3656d6ea6e0ffda), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2)]:
  - @termwright/resource-broker@0.5.0
  - @termwright/test@0.5.0
  - @termwright/driver@0.5.0
  - @termwright/gherkin@0.5.0
  - @termwright/run-history@0.5.0
  - @termwright/ink@0.5.0
  - @termwright/ui@0.5.0
  - @termwright/run-journal-transport@0.5.0
  - @termwright/mcp@0.5.0
  - @termwright/screenshot@0.5.0
  - @termwright/trace@0.5.0
  - @termwright/desktop-host@0.5.0
  - @termwright/protocol@0.5.0

## 0.4.1

### Patch Changes

- [#137](https://github.com/Gorce-AI/termwright/pull/137) [`bfb306d`](https://github.com/Gorce-AI/termwright/commit/bfb306dad13a6e34d667bf061e3f97a3aebe8464) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Canonicalize packed dependency metadata and batch npm visibility checks so delayed registry processing cannot strand a partial release.
- Updated dependencies []:
  - @termwright/desktop-host@0.4.1
  - @termwright/driver@0.4.1
  - @termwright/gherkin@0.4.1
  - @termwright/ink@0.4.1
  - @termwright/mcp@0.4.1
  - @termwright/protocol@0.4.1
  - @termwright/resource-broker@0.4.1
  - @termwright/run-history@0.4.1
  - @termwright/run-journal-transport@0.4.1
  - @termwright/screenshot@0.4.1
  - @termwright/test@0.4.1
  - @termwright/trace@0.4.1
  - @termwright/ui@0.4.1

## 0.4.0

### Minor Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Bound EventJournal admission by serialized bytes as well as event count, expose
  peak backlog telemetry, and replace per-event worker RPCs with bounded batches.
  Run-event protocol v3 also bounds event, producer, collision, and
  causal-reference validation state; causes must refer backwards within the
  declared horizon.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Require capability-aware resource telemetry in native run manifest v6, expose
  bounded journal admission metrics, and report unavailable capabilities without
  fabricated zeroes.
  Attempt finalization now publishes measured worker-process CPU and sampled peak
  RSS; manifest v6 validates and aggregates that evidence.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Publish exact streaming trace resource counters, including each writer's private staging-disk high-water, through authoritative run events and require run manifest v7 to reconstruct their aggregates independently.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep Vitest behind one private engine adapter, finalize concrete attempts through
  the public `onAfterRetryTask` lifecycle hook, and remove the runner and engine
  subpath exports.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Resolve worker and terminal admission from cgroup-aware CPU, memory, and temp
  disk budgets, and atomically schedule every attempt with CPU/memory/I/O weights.
  Use a bounded local p50/p95/EWMA cache to raise memory admission from measured
  worker RSS while retaining conservative defaults for new tests.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the scalar artifact value option with one secure policy, sanitize every
  Trace v4 stream before temporary persistence, and mask sensitive screenshot
  cells before rasterisation.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace finalize-heavy embedded run events with manifest v5 and an append-only,
  independently checksummed `events.ndjson` stream. Keep live event projections
  bounded while canonical history is written batch by batch.

### Patch Changes

- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`9f7e024`](https://github.com/Gorce-AI/termwright/commit/9f7e024c09c6d6ee401523cda4ffb4261891aed2), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/run-journal-transport@0.4.0
  - @termwright/run-history@0.4.0
  - @termwright/test@0.4.0
  - @termwright/driver@0.4.0
  - @termwright/ui@0.4.0
  - @termwright/trace@0.4.0
  - @termwright/mcp@0.4.0
  - @termwright/resource-broker@0.4.0
  - @termwright/screenshot@0.4.0
  - @termwright/ink@0.4.0
  - @termwright/gherkin@0.4.0
  - @termwright/desktop-host@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/desktop-host@0.3.2
  - @termwright/driver@0.3.2
  - @termwright/gherkin@0.3.2
  - @termwright/ink@0.3.2
  - @termwright/mcp@0.3.2
  - @termwright/protocol@0.3.2
  - @termwright/resource-broker@0.3.2
  - @termwright/run-history@0.3.2
  - @termwright/run-journal-transport@0.3.2
  - @termwright/screenshot@0.3.2
  - @termwright/test@0.3.2
  - @termwright/trace@0.3.2
  - @termwright/ui@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/driver@0.3.1
  - @termwright/ink@0.3.1
  - @termwright/mcp@0.3.1
  - @termwright/resource-broker@0.3.1
  - @termwright/run-history@0.3.1
  - @termwright/run-journal-transport@0.3.1
  - @termwright/screenshot@0.3.1
  - @termwright/test@0.3.1
  - @termwright/trace@0.3.1
  - @termwright/ui@0.3.1
  - @termwright/gherkin@0.3.1
  - @termwright/desktop-host@0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
  verdict across the Native Host, journal, CLI, history, and Runner. A partial
  skip exits successfully only when every observed skip and selected required
  declaration matches the repository's exact reviewed policy; undeclared,
  ambiguous, all-skipped, and stale-required cases remain non-certifying.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: replace the pre-release `test.scoped()` fixture-composition API with
  Vitest 4.1's `test.override()` API, without a compatibility alias.

  Gherkin-generated tests can now request typed custom fixtures from the same
  `test.extend()` runtime used by ordinary Vitest tests. Custom fixtures may
  depend on Termwright fixtures, keep native async setup/teardown ordering, and
  work through a custom `generatedImports.test` module.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the testing core with a frozen Effective Session Contract, strict
  evidence-qualified observations, one canonical Condition and ActionPlanner
  pipeline, real keyboard/mouse PTY devices, revision-safe receipts, semantic
  versus screen query domains, composable providers, and typed fail-closed errors.

  Certify exact source-bound Ink, Ratatui, and Bubble Tea integrations; compile
  tview's add-only capabilities without editing upstream bytes; and behaviorally
  certify runtime-capability OpenTUI and Textual integrations with adversarial
  real-process conformance. Add the desktop Runner, trace replay,
  Recorder and MCP projections of the same action model; shell commands, projects,
  Gherkin lifecycle/tooling, doctor/security/API documentation, and daily
  checksum-bound upstream compatibility certification with trusted autonomous
  merge and coordinated npm/PyPI/crates.io release.

  Consolidate Ink annotations and component testing into `@termwright/ink` and
  remove the pre-release-only `@termwright/ink-testing` and semantic protocol v1
  compatibility surfaces.

  Windows now uses Termwright's own ConPTY backend with x64 and ARM64 prebuild
  packages, authoritative pipe completion, and job-object process ownership.
  There is no weaker fallback: a missing native package fails closed with an
  actionable error.

  Repository and release certification run on the first workflow attempt with
  zero retries and snapshot updates disabled. Diagnostic retries retain every
  attempt, classify fail-then-pass as flaky, and remain non-zero rather than
  turning an unstable run green.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: narrow the supported driver root to application-facing terminal,
  locator, action, observation, value-policy, and error APIs. Low-level PTY
  backends, key/mouse encoders, selector parsers, process supervision, inherited
  environment construction, and launch-resource injection now live exclusively
  under `@termwright/driver/experimental`. The pre-stable API has no compatibility
  re-exports or deprecated aliases.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Harden live HTTP and Runner boundaries with per-launch MCP bearer
  authentication, exact Origin policy, explicit non-loopback opt-in, bounded
  authenticated and preflight rate limits, and opt-in token disclosure.

  Runner viewers and producers now use separate credentials. Producer ownership
  is bound to a run generation, semantic snapshots are validated at ingress, and
  UTF-8 replay/client queues have strict byte ceilings with deterministic
  disconnect and cleanup behavior.

  The Runner now commits its HTTP snapshot before subscribing to the replaying
  WebSocket. Live session and semantic events therefore cannot be overwritten by
  a slower bootstrap response.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Add shared ARIA tree navigation to the Semantic Inspector and Specs catalogue:
  one roving tab stop, Up/Down/Home/End traversal, Left/Right branch navigation,
  and focus and selection retention across live re-renders.

  Runner URLs now retain the active view, run, execution, trace, and replay
  position across refresh and Back/Forward. Authentication is removed from the
  address before React starts and remains tab-scoped rather than becoming part of
  a copied deep link or browser history state.

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Commit semantic frames only at causal framework output boundaries. OpenTUI now
  observes render geometry at runtime instead of patching generated render-loop
  operations; Bubble Tea commits staged model observations after renderer flush;
  its frame-to-marker admission is non-blocking and fails concurrent/reentrant
  flushes closed before output rather than stalling a render loop;
  disabled Bubble Tea probing is cached once and leaves later render/flush calls
  as allocation-free atomic no-ops;
  and tview chains public draw hooks to arm only the final call through its screen
  decorator. Intermediate custom/hook `Show` calls cannot publish partial trees;
  the final boundary publishes a compiler-checked add-only semantic snapshot with
  same-output marker ordering on Unix and Windows. Existing tview and tcell source
  files are no longer copied or patched.

  The Termwright CLI now projects recognized toolchain and
  candidate-certification controls into Vitest's explicit worker configuration,
  so required Go/Bun and candidate-profile requirements remain visible at module
  evaluation.

  Textual strong instrumentation is admitted by runtime capability checks and
  behavioral conformance, rejects partial display attempts, publishes only fresh
  post-handshake frames, and appends markers non-blockingly through the observed
  frame writer. Its private causal seam remains explicit T3 debt without a
  version allowlist.

  Framework compatibility now reports the intervention tier per capability,
  semantic class, named degradation and tracked T3 debt. Capability-driven T1
  candidate runs compile owned units directly against tview, tcell and Bubbles;
  they no longer manufacture exact source profiles for integrations that do not
  edit upstream bytes.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Decompose terminal sessions into independently tested process, evidence,
  action, input-barrier, and semantic-contract units, and split the persistent
  test host into explicit coordination, Vitest-adapter, and persistence/finalizer
  components. Public behavior, event ordering, teardown, and failure semantics
  remain unchanged.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove migration of pre-release Runner preference keys. The Runner now reads
  only its current versioned preference storage and otherwise starts from fresh
  defaults, without retaining compatibility paths for unpublished schemas.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Certify upstream framework releases: bubbles-v1@v1.0.0, bubbles-v2@v2.1.1, bubbles-v2@v2.2.0, bubbles-v2@v2.2.1, bubbletea-v1@v1.3.10, bubbletea-v2@v2.0.8, bubbletea-v2@v2.0.9, ink@7.1.1, opentui@0.5.3, opentui@0.5.4, opentui@0.5.6, opentui@0.5.7, opentui@0.5.8, opentui@0.5.9, ratatui-core@0.1.2, ratatui-crossterm@0.1.2, ratatui-widgets@0.3.2, tcell-v2@v2.10.0, tcell-v2@v2.11.0, tcell-v2@v2.12.0, tcell-v2@v2.12.1, tcell-v2@v2.12.2, tcell-v2@v2.13.0, tcell-v2@v2.13.1, tcell-v2@v2.13.10, tcell-v2@v2.13.2, tcell-v2@v2.13.3, tcell-v2@v2.13.4, tcell-v2@v2.13.5, tcell-v2@v2.13.6, tcell-v2@v2.13.7, tcell-v2@v2.13.8, tcell-v2@v2.13.9, tcell-v2@v2.8.1, tcell-v2@v2.9.0, textual@8.2.8, tview@v0.42.0.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Roll back partially acquired semantic and Ink control endpoints when
  Unix-socket or Windows named-pipe listener startup fails, including
  deterministic cleanup-error reporting instead of leaking endpoint lifecycles.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep shared probe build outputs immutable while the Native Host is running,
  with a pre-host content fingerprint that builds missing fresh-clone inputs,
  rebuilds stale inputs, and rejects source or artifact changes inside test
  workers. Settle deadline, process-exit and Ink render race branches during
  teardown. A cancelled desktop control bind now remains owned until a late
  listener is closed, so startup rollback cannot leave an orphaned socket or
  named pipe. Promote Vitest
  async-handle leak evidence into a non-certifying infrastructure result.

  Compare exact reference and candidate revisions on one macOS runner in a fixed
  reference/candidate/candidate/reference sequence. The paired gate binds the
  toolchain, measurement harness, controller, round order, subject commit, CI
  attempt and every raw report with SHA-256 provenance; Bun/OpenTUI is mandatory,
  and process and file-descriptor leaks remain exact-zero invariants.

  Move native run manifests to schema v3 with host-monotonic total duration and
  per-attempt start/finish offsets. Validate those intervals against the run
  boundary and reject v2 or internally inconsistent timing evidence.

  The independent Windows Vitest/PTY reliability harness now invokes the exact
  lockfile-backed Vitest entry point directly through Node instead of relying on
  non-executable `.cmd` shell shims.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep the local Native Host profile at two Vitest forks while retaining capacity
  for four simultaneous terminals. Worker journal cleanup now drains and closes
  its socket on every path, and its close barrier resolves only after the socket
  has actually closed, so teardown correctness does not depend on serializing the
  monorepo or leaving transport handles for process termination. The Native Host
  also drains Vitest's worker pool before advancing its lifecycle, while run
  history validates attempt ordering in one pass instead of blocking worker
  termination with work proportional to attempts multiplied by journal events.
  Persistent-host verdicts are now derived only from the native tasks selected
  for the current cycle, so Vitest modules retained from an earlier cycle cannot
  contaminate later skip evidence. Explicit partial Vitest catalogues no longer
  make unrelated repository-wide required skips appear stale, while every
  observed skip still needs one exact declaration. Static Ink probe metadata
  checks no longer load the render-session runtime.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve native ConPTY output, exit evidence, and the first fatal I/O error
  emitted before the terminal journal attaches, and make managed PowerShell
  readiness a causal startup marker instead of a quiet-window input race.

  Load screenshot fallback fonts only when a requested glyph needs them and keep
  the shared parsed-face cache bounded and file-identity-aware. ASCII screenshots
  no longer eagerly parse Windows CJK and emoji collections, while style,
  fallback, and colour-emoji fidelity remain unchanged.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Allow injected Native Host engines to provide explicit Git provenance while production hosts continue automatic capture. Host lifecycle tests now clean up causally without depending on Windows filesystem or process latency.
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/run-history@0.3.0
  - @termwright/ui@0.3.0
  - @termwright/resource-broker@0.3.0
  - @termwright/run-journal-transport@0.3.0
  - @termwright/gherkin@0.3.0
  - @termwright/test@0.3.0
  - @termwright/desktop-host@0.3.0
  - @termwright/ink@0.3.0
  - @termwright/mcp@0.3.0
  - @termwright/screenshot@0.3.0
  - @termwright/trace@0.3.0

## 0.2.0

### Minor Changes

- [`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace manual semantic adapters with zero-config framework probes for Ink,
  OpenTUI, Textual, Ratatui, tview, and Bubble Tea. Add framework-native optional
  annotation SDKs, provenance-aware semantic trees, extended state and relations,
  compatibility metadata, inspector probe health, and retained/immediate-mode
  performance reporting.

  This removes the legacy renderer-replacement and manual attachment APIs.

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.2.0
  - @termwright/ink@0.2.0
  - @termwright/mcp@0.2.0
  - @termwright/screenshot@0.2.0
  - @termwright/test@0.2.0
  - @termwright/trace@0.2.0
  - @termwright/ui@0.2.0
  - @termwright/gherkin@0.2.0
  - @termwright/desktop-host@0.2.0
