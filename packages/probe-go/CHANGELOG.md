# @termwright/probe-go

## 0.3.0

### Minor Changes

- [#45](https://github.com/Gorce-AI/termwright/pull/45) [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Expose and validate per-run semantic probe intervention metadata, including the
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

- [#56](https://github.com/Gorce-AI/termwright/pull/56) [`e902920`](https://github.com/Gorce-AI/termwright/commit/e9029203de11ca2989517c3d603e83940bb92b82) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Return the canonical Go module directory required as the instrumented build cwd, preserve the caller's effective workspace, and fail closed when Charm instrumentation would replace a vendored dependency graph.

  Keep Linux process-group teardown authoritative when an unrelated `/proc` entry disappears during the owned-tree scan.

- [#12](https://github.com/Gorce-AI/termwright/pull/12) [`bb22ef3`](https://github.com/Gorce-AI/termwright/commit/bb22ef3dfd6cfbc1ab7644e07f5b9904ee54f6c7) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Commit semantic frames only at causal framework output boundaries. OpenTUI now
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

## 0.2.0
