# @termwright/test

## 0.3.0

### Minor Changes

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: replace the pre-release `test.scoped()` fixture-composition API with
  Vitest 4.1's `test.override()` API, without a compatibility alias.

  Gherkin-generated tests can now request typed custom fixtures from the same
  `test.extend()` runtime used by ordinary Vitest tests. Custom fixtures may
  depend on Termwright fixtures, keep native async setup/teardown ordering, and
  work through a custom `generatedImports.test` module.

### Patch Changes

- [#10](https://github.com/Gorce-AI/termwright/pull/10) [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep the local Native Host profile at two Vitest forks while retaining capacity
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
- Updated dependencies [[`fc625dc`](https://github.com/Gorce-AI/termwright/commit/fc625dc903327833a75a1491158a2e4d57c2d9e0), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`9dfeaf9`](https://github.com/Gorce-AI/termwright/commit/9dfeaf9a6e5778ee03eb82ea3287748beffc58d4), [`54bdd45`](https://github.com/Gorce-AI/termwright/commit/54bdd454f05d9510bba991ffe745c3b31f5db74d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`2272a13`](https://github.com/Gorce-AI/termwright/commit/2272a13016ee42e054a43015489712ee006e564d), [`e760f91`](https://github.com/Gorce-AI/termwright/commit/e760f9126caa8166078289b64845ca03e3889cf6), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e), [`0c715f1`](https://github.com/Gorce-AI/termwright/commit/0c715f1d9bfb3087973a1278fc71ee6acf305855), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`7cac416`](https://github.com/Gorce-AI/termwright/commit/7cac4160c94868448c74e9b09ed7c082a2f3ef26), [`fd5c791`](https://github.com/Gorce-AI/termwright/commit/fd5c791b29be3d29102f5f2019bd44bff7edcae1)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/ui@0.3.0
  - @termwright/resource-broker@0.3.0
  - @termwright/run-journal-transport@0.3.0
  - @termwright/trace@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
  - @termwright/trace@0.2.0
  - @termwright/ui@0.2.0
