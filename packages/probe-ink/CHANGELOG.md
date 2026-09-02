# @termwright/probe-ink

## 0.4.0

### Patch Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.
- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/probe-runtime@0.4.0
  - @termwright/recognizers@0.4.0
  - @termwright/vt@0.4.0
  - @termwright/evidence-provider@0.4.0
  - @termwright/pty@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/evidence-provider@0.3.2
  - @termwright/probe-runtime@0.3.2
  - @termwright/protocol@0.3.2
  - @termwright/pty@0.3.2
  - @termwright/recognizers@0.3.2
  - @termwright/vt@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/pty@0.3.1
  - @termwright/evidence-provider@0.3.1
  - @termwright/probe-runtime@0.3.1
  - @termwright/recognizers@0.3.1
  - @termwright/vt@0.3.1

## 0.3.0

### Minor Changes

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

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Certify upstream framework releases: bubbles-v1@v1.0.0, bubbles-v2@v2.1.1, bubbles-v2@v2.2.0, bubbles-v2@v2.2.1, bubbletea-v1@v1.3.10, bubbletea-v2@v2.0.8, bubbletea-v2@v2.0.9, ink@7.1.1, opentui@0.5.3, opentui@0.5.4, opentui@0.5.6, opentui@0.5.7, opentui@0.5.8, opentui@0.5.9, ratatui-core@0.1.2, ratatui-crossterm@0.1.2, ratatui-widgets@0.3.2, tcell-v2@v2.10.0, tcell-v2@v2.11.0, tcell-v2@v2.12.0, tcell-v2@v2.12.1, tcell-v2@v2.12.2, tcell-v2@v2.13.0, tcell-v2@v2.13.1, tcell-v2@v2.13.10, tcell-v2@v2.13.2, tcell-v2@v2.13.3, tcell-v2@v2.13.4, tcell-v2@v2.13.5, tcell-v2@v2.13.6, tcell-v2@v2.13.7, tcell-v2@v2.13.8, tcell-v2@v2.13.9, tcell-v2@v2.8.1, tcell-v2@v2.9.0, textual@8.2.8, tview@v0.42.0.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Pass native absolute paths to Bun's preload resolver while retaining file URLs
  for Node imports. This makes the zero-config launchers work on Windows; their
  process contracts now surface preload exit diagnostics before waiting for
  semantic evidence.

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

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Bind fixture rerender acknowledgements to the exact committed Ink host generation and add command identities so stale render callbacks or late control replies cannot acknowledge a newer rerender. Authenticate control peers before electing the fixture connection and isolate bounded per-peer input so strangers cannot reserve or poison the channel.
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/pty@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/evidence-provider@0.3.0
  - @termwright/probe-runtime@0.3.0
  - @termwright/recognizers@0.3.0
  - @termwright/vt@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/probe-runtime@0.2.0
  - @termwright/recognizers@0.2.0
