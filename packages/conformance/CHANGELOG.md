# @termwright/conformance

## 0.3.0

### Minor Changes

- [#44](https://github.com/Gorce-AI/termwright/pull/44) [`fd5c791`](https://github.com/Gorce-AI/termwright/commit/fd5c791b29be3d29102f5f2019bd44bff7edcae1) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Ship and verify a pinned modern Microsoft ConPTY runtime on Windows so semantic
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

- [#61](https://github.com/Gorce-AI/termwright/pull/61) [`54bdd45`](https://github.com/Gorce-AI/termwright/commit/54bdd454f05d9510bba991ffe745c3b31f5db74d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make action observation waits causal across independent Windows semantic and
  PTY transports: pending frames arm before inspection and wake on lifecycle
  transitions. Close adapter probe artifacts only after endpoint admission, the
  owned process tree, authoritative output EOF, and terminal parser drain have
  all completed.
- Updated dependencies [[`fc625dc`](https://github.com/Gorce-AI/termwright/commit/fc625dc903327833a75a1491158a2e4d57c2d9e0), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`9dfeaf9`](https://github.com/Gorce-AI/termwright/commit/9dfeaf9a6e5778ee03eb82ea3287748beffc58d4), [`54bdd45`](https://github.com/Gorce-AI/termwright/commit/54bdd454f05d9510bba991ffe745c3b31f5db74d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`2272a13`](https://github.com/Gorce-AI/termwright/commit/2272a13016ee42e054a43015489712ee006e564d), [`e760f91`](https://github.com/Gorce-AI/termwright/commit/e760f9126caa8166078289b64845ca03e3889cf6), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e), [`0c715f1`](https://github.com/Gorce-AI/termwright/commit/0c715f1d9bfb3087973a1278fc71ee6acf305855), [`7cac416`](https://github.com/Gorce-AI/termwright/commit/7cac4160c94868448c74e9b09ed7c082a2f3ef26), [`fd5c791`](https://github.com/Gorce-AI/termwright/commit/fd5c791b29be3d29102f5f2019bd44bff7edcae1)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/resource-broker@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
