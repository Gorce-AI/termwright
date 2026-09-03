# @termwright/driver

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace misleading generic owned-process RSS/count fields with capability-qualified whole-tree accounting. Windows sessions now capture cumulative Job Object CPU, memory, process, and I/O counters before disposal; run manifest v8 preserves their native meanings and reports unsupported platforms as unavailable.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove an unused UI provider facade and rename the Ink probe's required advanced
  instrumentation entry point so no published subpath pretends an internal API is
  a supported user contract. Terminal profile options now accept only the two
  registered behavior profiles and configuration rejects unknown ids eagerly.

### Patch Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep POSIX shell command tracking authoritative when an interactive shell enables `errexit`, so failed commands still emit their completion boundary and return an exit status instead of timing out. Generic terminal resize receipts no longer misclassify arbitrary later PTY bytes as proof of an application repaint; paired render evidence is reported only when a semantic adapter can prove it.
- Updated dependencies []:
  - @termwright/protocol@0.5.0
  - @termwright/vt@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.4.1
  - @termwright/vt@0.4.1

## 0.4.0

### Minor Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Retain capped session diagnostics, application logs, and crash inputs in O(1)
  ring buffers under sustained floods.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the scalar artifact value option with one secure policy, sanitize every
  Trace v4 stream before temporary persistence, and mask sensitive screenshot
  cells before rasterisation.

### Patch Changes

- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/vt@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.3.2
  - @termwright/vt@0.3.2

## 0.3.1

### Patch Changes

- [#122](https://github.com/Gorce-AI/termwright/pull/122) [`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Transfer ownership of the Go client's evidence-provider lease exactly once when concurrent socket and publication shutdown paths close the same session. Preserve complete race-detector diagnostics from the full tview PTY certification instead of relying on terminal-screen text that the detector does not write.

  Deliver each Windows application terminal reply through the private `twh-app-reply-v1` envelope. Patched OpenConsole buffers the complete OSC, validates its length and encoding, then commits the decoded reply in one input-buffer operation regardless of the child's VT-input mode. This prevents both per-byte mode-report corruption and raw CPR consumption as an F3 key.

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/vt@0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: narrow the supported driver root to application-facing terminal,
  locator, action, observation, value-policy, and error APIs. Low-level PTY
  backends, key/mouse encoders, selector parsers, process supervision, inherited
  environment construction, and launch-resource injection now live exclusively
  under `@termwright/driver/experimental`. The pre-stable API has no compatibility
  re-exports or deprecated aliases.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace node-pty and the separate ConPTY loader with one Termwright-owned native
  PTY backend that provides authoritative output EOF and owned process trees on
  all supported platforms. Native input admission and native-to-JavaScript output
  delivery are bounded and backpressured; overflow, write failure, missing Windows
  completion-port support, and missing platform addons fail closed.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Expose and validate per-run semantic probe intervention metadata, including the
  engaged injection tier, geometry class, and named degraded capabilities. The
  effective session contract and Runner now preserve those facts so reduced
  framework coverage cannot silently look complete.

  Add the generic Go `-toolexec` path for compiler-checked, add-only package units.
  tview and Bubbles builds reuse a content-addressed compiler identity across
  temporary materialisation directories while invalidating it for changed owned
  sources or injected import archives.
  tview now uses one dormant application attachment plus public draw hooks and
  owned tview/tcell units without copying or patching upstream modules. Bubbles
  private-state readers use the same mechanism, while Bubble Tea retains only the
  exact model and render-flush hooks required for causal semantic publication.

  OpenTUI moves semantic geometry and hit-grid observation to runtime hooks while
  retaining its narrow structural native-output transform. Ink includes the
  composable React commit bridge and differential evidence explaining why exact
  renderer instrumentation remains necessary for full fidelity.

  Ratatui now sizes its asynchronous publication queue from the negotiated
  semantic in-flight limit instead of a scheduler-sensitive hard-coded value.
  `terminal.launch({ semanticFrameQueueCapacity })` can raise that bounded limit
  for intentional synchronous render bursts, and an exact overflow diagnostic
  reports the active budget and an actionable remediation.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Ship and verify a pinned modern Microsoft ConPTY runtime on Windows so semantic
  frame markers preserve causal output ordering. Windows sessions now fail closed
  when the complete pinned, hash-verified runtime bundle cannot be loaded instead
  of silently using the inbox conhost implementation. Behavioral certification is
  bound separately to the exact runtime and native conformance verdict. The
  ordered passthrough stream also
  restores authoritative mouse/focus mode observation on Windows, and the tview
  marker writer now brackets its causal write with an exact VT output-mode guard.
  Ink, OpenTUI, and Bubble Tea share the same mode-safe exact-handle marker
  contract under Node and Bun.

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Separate adapter discovery from the bounded hello handshake so a peer accepted before discovery closes can authenticate deterministically, while capping active semantic sockets and refusing late peers fail-closed. Keep process cleanup deadlines in the same lazy monotonic-clock domain as their session so launch rollback remains bounded and reliable across supported Node runtimes.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make local endpoint shutdown a causal barrier on Windows and POSIX. Accepted semantic sockets are now destroyed before listener completion, late connections are rejected during shutdown, and listener cleanup still completes when an individual socket teardown reports an error.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Close emulator-generated terminal-response forwarding at the causal process
  tree and PTY-input boundaries. Delayed xterm replies can no longer race native
  Windows PTY disposal, while real response-write failures remain explicit
  infrastructure failures.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make action observation waits causal across independent Windows semantic and
  PTY transports: pending frames arm before inspection and wake on lifecycle
  transitions. Close adapter probe artifacts only after endpoint admission, the
  owned process tree, authoritative output EOF, and terminal parser drain have
  all completed.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Decompose terminal sessions into independently tested process, evidence,
  action, input-barrier, and semantic-contract units, and split the persistent
  test host into explicit coordination, Vitest-adapter, and persistence/finalizer
  components. Public behavior, event ordering, teardown, and failure semantics
  remain unchanged.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Filter Linux process-group candidates before opening pidfds, preserve the
  post-open identity check, and surface native lifecycle errno diagnostics with
  open-file-limit guidance instead of reporting an unproven live process tree.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
  cursor synchronization uses a private request-addressed OpenConsole RPC, and
  ordinary application replies use Win32 Input Mode instead of surfacing as key
  presses.
  Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
  flush cannot race recovery bookkeeping and leave the semantic revision stale.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Expose locator retry waits through a structured `action-observation-wait`
  diagnostic. Its `actionId` correlates the wait with the action lifecycle, while
  `observationState` identifies the exact in-flight parser, semantic-frame, or
  render-pairing boundary that must settle before input can be sent.

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

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve native ConPTY output, exit evidence, and the first fatal I/O error
  emitted before the terminal journal attaches, and make managed PowerShell
  readiness a causal startup marker instead of a quiet-window input race.

  Load screenshot fallback fonts only when a requested glyph needs them and keep
  the shared parsed-face cache bounded and file-identity-aware. ASCII screenshots
  no longer eagerly parse Windows CJK and emoji collections, while style,
  fallback, and colour-emoji fidelity remain unchanged.

- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/protocol@0.3.0
  - @termwright/vt@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/vt@0.2.0
