# @termwright/conformance

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove the public resource-broker Vitest subpath and its optional Vitest peer. Resource-aware declarations now belong exclusively to Termwright's embedded test surface, and adapter conformance uses that same owned engine instead of resolving a consumer Vitest.

### Patch Changes

- Updated dependencies [[`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`3d0d95f`](https://github.com/Gorce-AI/termwright/commit/3d0d95ff3980bb8d656bcad2c3656d6ea6e0ffda), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2)]:
  - @termwright/test@0.5.0
  - @termwright/driver@0.5.0
  - @termwright/protocol@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.4.1
  - @termwright/protocol@0.4.1
  - @termwright/resource-broker@0.4.1

## 0.4.0

### Patch Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.
- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/driver@0.4.0
  - @termwright/resource-broker@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.3.2
  - @termwright/protocol@0.3.2
  - @termwright/resource-broker@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/driver@0.3.1
  - @termwright/resource-broker@0.3.1

## 0.3.0

### Minor Changes

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

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make action observation waits causal across independent Windows semantic and
  PTY transports: pending frames arm before inspection and wake on lifecycle
  transitions. Close adapter probe artifacts only after endpoint admission, the
  owned process tree, authoritative output EOF, and terminal parser drain have
  all completed.
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/resource-broker@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
