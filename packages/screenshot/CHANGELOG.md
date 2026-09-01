# @termwright/screenshot

## 0.3.0

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve native ConPTY output, exit evidence, and the first fatal I/O error
  emitted before the terminal journal attaches, and make managed PowerShell
  readiness a causal startup marker instead of a quiet-window input race.

  Load screenshot fallback fonts only when a requested glyph needs them and keep
  the shared parsed-face cache bounded and file-identity-aware. ASCII screenshots
  no longer eagerly parse Windows CJK and emoji collections, while style,
  fallback, and colour-emoji fidelity remain unchanged.

- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
