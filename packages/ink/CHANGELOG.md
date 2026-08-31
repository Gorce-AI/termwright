# @termwright/ink

## 0.3.0

### Patch Changes

- [#74](https://github.com/Gorce-AI/termwright/pull/74) [`de4b57f`](https://github.com/Gorce-AI/termwright/commit/de4b57fceef6befdc5d5dacd29f39fd4d02e9d7c) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Certify upstream framework releases: bubbles-v1@v1.0.0, bubbles-v2@v2.1.1, bubbles-v2@v2.2.0, bubbles-v2@v2.2.1, bubbletea-v1@v1.3.10, bubbletea-v2@v2.0.8, bubbletea-v2@v2.0.9, ink@7.1.1, opentui@0.5.3, opentui@0.5.4, opentui@0.5.6, opentui@0.5.7, opentui@0.5.8, opentui@0.5.9, ratatui-core@0.1.2, ratatui-crossterm@0.1.2, ratatui-widgets@0.3.2, tcell-v2@v2.10.0, tcell-v2@v2.11.0, tcell-v2@v2.12.0, tcell-v2@v2.12.1, tcell-v2@v2.12.2, tcell-v2@v2.13.0, tcell-v2@v2.13.1, tcell-v2@v2.13.10, tcell-v2@v2.13.2, tcell-v2@v2.13.3, tcell-v2@v2.13.4, tcell-v2@v2.13.5, tcell-v2@v2.13.6, tcell-v2@v2.13.7, tcell-v2@v2.13.8, tcell-v2@v2.13.9, tcell-v2@v2.8.1, tcell-v2@v2.9.0, textual@8.2.8, tview@v0.42.0.

- [#10](https://github.com/Gorce-AI/termwright/pull/10) [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Roll back partially acquired semantic and Ink control endpoints when
  Unix-socket or Windows named-pipe listener startup fails, including
  deterministic cleanup-error reporting instead of leaking endpoint lifecycles.

- [#14](https://github.com/Gorce-AI/termwright/pull/14) [`9bd3a21`](https://github.com/Gorce-AI/termwright/commit/9bd3a216996ccf6ba85011606e99fbb006ed9b83) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Bind fixture rerender acknowledgements to the exact committed Ink host generation and add command identities so stale render callbacks or late control replies cannot acknowledge a newer rerender. Authenticate control peers before electing the fixture connection and isolate bounded per-peer input so strangers cannot reserve or poison the channel.
- Updated dependencies [[`fc625dc`](https://github.com/Gorce-AI/termwright/commit/fc625dc903327833a75a1491158a2e4d57c2d9e0), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`9dfeaf9`](https://github.com/Gorce-AI/termwright/commit/9dfeaf9a6e5778ee03eb82ea3287748beffc58d4), [`54bdd45`](https://github.com/Gorce-AI/termwright/commit/54bdd454f05d9510bba991ffe745c3b31f5db74d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`de4b57f`](https://github.com/Gorce-AI/termwright/commit/de4b57fceef6befdc5d5dacd29f39fd4d02e9d7c), [`2272a13`](https://github.com/Gorce-AI/termwright/commit/2272a13016ee42e054a43015489712ee006e564d), [`e760f91`](https://github.com/Gorce-AI/termwright/commit/e760f9126caa8166078289b64845ca03e3889cf6), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e), [`0c715f1`](https://github.com/Gorce-AI/termwright/commit/0c715f1d9bfb3087973a1278fc71ee6acf305855), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`7cac416`](https://github.com/Gorce-AI/termwright/commit/7cac4160c94868448c74e9b09ed7c082a2f3ef26), [`9bd3a21`](https://github.com/Gorce-AI/termwright/commit/9bd3a216996ccf6ba85011606e99fbb006ed9b83), [`fd5c791`](https://github.com/Gorce-AI/termwright/commit/fd5c791b29be3d29102f5f2019bd44bff7edcae1)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/probe-ink@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
  - @termwright/probe-ink@0.2.0
