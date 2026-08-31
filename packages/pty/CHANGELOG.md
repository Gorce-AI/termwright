# @termwright/pty

## 0.3.0

### Minor Changes

- [#44](https://github.com/Gorce-AI/termwright/pull/44) [`e760f91`](https://github.com/Gorce-AI/termwright/commit/e760f9126caa8166078289b64845ca03e3889cf6) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace node-pty and the separate ConPTY loader with one Termwright-owned native
  PTY backend that provides authoritative output EOF and owned process trees on
  all supported platforms. Native input admission and native-to-JavaScript output
  delivery are bounded and backpressured; overflow, write failure, missing Windows
  completion-port support, and missing platform addons fail closed.

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

- [#56](https://github.com/Gorce-AI/termwright/pull/56) [`e902920`](https://github.com/Gorce-AI/termwright/commit/e9029203de11ca2989517c3d603e83940bb92b82) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Return the canonical Go module directory required as the instrumented build cwd, preserve the caller's effective workspace, and fail closed when Charm instrumentation would replace a vendored dependency graph.

  Keep Linux process-group teardown authoritative when an unrelated `/proc` entry disappears during the owned-tree scan.

- [#47](https://github.com/Gorce-AI/termwright/pull/47) [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Filter Linux process-group candidates before opening pidfds, preserve the
  post-open identity check, and surface native lifecycle errno diagnostics with
  open-file-limit guidance instead of reporting an unproven live process tree.

- [#104](https://github.com/Gorce-AI/termwright/pull/104) [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
  cursor synchronization uses a private request-addressed OpenConsole RPC, and
  ordinary application replies use Win32 Input Mode instead of surfacing as key
  presses.
  Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
  flush cannot race recovery bookkeeping and leave the semantic revision stale.
- Updated dependencies [[`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e)]:
  - @termwright/protocol@0.3.0
