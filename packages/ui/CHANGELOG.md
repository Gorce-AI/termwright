# @termwright/ui

## 0.3.0

### Minor Changes

- [#10](https://github.com/Gorce-AI/termwright/pull/10) [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
  verdict across the Native Host, journal, CLI, history, and Runner. A partial
  skip exits successfully only when every observed skip and selected required
  declaration matches the repository's exact reviewed policy; undeclared,
  ambiguous, all-skipped, and stale-required cases remain non-certifying.

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Harden live HTTP and Runner boundaries with per-launch MCP bearer
  authentication, exact Origin policy, explicit non-loopback opt-in, bounded
  authenticated and preflight rate limits, and opt-in token disclosure.

  Runner viewers and producers now use separate credentials. Producer ownership
  is bound to a run generation, semantic snapshots are validated at ingress, and
  UTF-8 replay/client queues have strict byte ceilings with deterministic
  disconnect and cleanup behavior.

  The Runner now commits its HTTP snapshot before subscribing to the replaying
  WebSocket. Live session and semantic events therefore cannot be overwritten by
  a slower bootstrap response.

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Add shared ARIA tree navigation to the Semantic Inspector and Specs catalogue:
  one roving tab stop, Up/Down/Home/End traversal, Left/Right branch navigation,
  and focus and selection retention across live re-renders.

  Runner URLs now retain the active view, run, execution, trace, and replay
  position across refresh and Back/Forward. Authentication is removed from the
  address before React starts and remains tab-scoped rather than becoming part of
  a copied deep link or browser history state.

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

- [#10](https://github.com/Gorce-AI/termwright/pull/10) [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove migration of pre-release Runner preference keys. The Runner now reads
  only its current versioned preference storage and otherwise starts from fresh
  defaults, without retaining compatibility paths for unpublished schemas.
- Updated dependencies [[`fc625dc`](https://github.com/Gorce-AI/termwright/commit/fc625dc903327833a75a1491158a2e4d57c2d9e0), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`9dfeaf9`](https://github.com/Gorce-AI/termwright/commit/9dfeaf9a6e5778ee03eb82ea3287748beffc58d4), [`54bdd45`](https://github.com/Gorce-AI/termwright/commit/54bdd454f05d9510bba991ffe745c3b31f5db74d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`2272a13`](https://github.com/Gorce-AI/termwright/commit/2272a13016ee42e054a43015489712ee006e564d), [`e760f91`](https://github.com/Gorce-AI/termwright/commit/e760f9126caa8166078289b64845ca03e3889cf6), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e), [`0c715f1`](https://github.com/Gorce-AI/termwright/commit/0c715f1d9bfb3087973a1278fc71ee6acf305855), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`7cac416`](https://github.com/Gorce-AI/termwright/commit/7cac4160c94868448c74e9b09ed7c082a2f3ef26), [`fd5c791`](https://github.com/Gorce-AI/termwright/commit/fd5c791b29be3d29102f5f2019bd44bff7edcae1)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/run-history@0.3.0
  - @termwright/trace@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.2.0
  - @termwright/trace@0.2.0
