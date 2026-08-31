# @termwright/protocol

## 0.3.0

### Minor Changes

- [#10](https://github.com/Gorce-AI/termwright/pull/10) [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
  verdict across the Native Host, journal, CLI, history, and Runner. A partial
  skip exits successfully only when every observed skip and selected required
  declaration matches the repository's exact reviewed policy; undeclared,
  ambiguous, all-skipped, and stale-required cases remain non-certifying.

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

- [#104](https://github.com/Gorce-AI/termwright/pull/104) [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
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
