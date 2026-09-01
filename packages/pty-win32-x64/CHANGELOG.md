# @termwright/pty-win32-x64

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace node-pty and the separate ConPTY loader with one Termwright-owned native
  PTY backend that provides authoritative output EOF and owned process trees on
  all supported platforms. Native input admission and native-to-JavaScript output
  delivery are bounded and backpressured; overflow, write failure, missing Windows
  completion-port support, and missing platform addons fail closed.

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

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
  cursor synchronization uses a private request-addressed OpenConsole RPC, and
  ordinary application replies use Win32 Input Mode instead of surfacing as key
  presses.
  Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
  flush cannot race recovery bookkeeping and leave the semantic revision stale.
