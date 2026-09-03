# @termwright/protocol

## 0.5.0

## 0.4.1

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

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the scalar artifact value option with one secure policy, sanitize every
  Trace v4 stream before temporary persistence, and mask sensitive screenshot
  cells before rasterisation.

## 0.3.2

## 0.3.1

### Patch Changes

- [#122](https://github.com/Gorce-AI/termwright/pull/122) [`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Transfer ownership of the Go client's evidence-provider lease exactly once when concurrent socket and publication shutdown paths close the same session. Preserve complete race-detector diagnostics from the full tview PTY certification instead of relying on terminal-screen text that the detector does not write.

  Deliver each Windows application terminal reply through the private `twh-app-reply-v1` envelope. Patched OpenConsole buffers the complete OSC, validates its length and encoding, then commits the decoded reply in one input-buffer operation regardless of the child's VT-input mode. This prevents both per-byte mode-report corruption and raw CPR consumption as an F3 key.

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
  verdict across the Native Host, journal, CLI, history, and Runner. A partial
  skip exits successfully only when every observed skip and selected required
  declaration matches the repository's exact reviewed policy; undeclared,
  ambiguous, all-skipped, and stale-required cases remain non-certifying.

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

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
  cursor synchronization uses a private request-addressed OpenConsole RPC, and
  ordinary application replies use Win32 Input Mode instead of surfacing as key
  presses.
  Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
  flush cannot race recovery bookkeeping and leave the semantic revision stale.

## 0.2.0

### Minor Changes

- [`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace manual semantic adapters with zero-config framework probes for Ink,
  OpenTUI, Textual, Ratatui, tview, and Bubble Tea. Add framework-native optional
  annotation SDKs, provenance-aware semantic trees, extended state and relations,
  compatibility metadata, inspector probe health, and retained/immediate-mode
  performance reporting.

  This removes the legacy renderer-replacement and manual attachment APIs.
