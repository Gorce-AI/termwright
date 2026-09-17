# @termwright/pty

## 0.7.4

### Patch Changes

- [#177](https://github.com/Gorce-AI/termwright/pull/177) [`af0cdf5`](https://github.com/Gorce-AI/termwright/commit/af0cdf5612ca051551f53fec8fac9b1ea979a427) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Defer packed-artifact terminal replies until native output delivery has unwound, fixing Windows x64 certification under ARM64 emulation.

- [#179](https://github.com/Gorce-AI/termwright/pull/179) [`eb5e72d`](https://github.com/Gorce-AI/termwright/commit/eb5e72d930a9a254f5b870993251ab3a29da9f27) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Defer Windows terminal responses until the native output callback has fully returned to libuv. Responses remain ordered and memory-bounded, and asynchronous native rejection is reported through the PTY error channel. This fixes intermittent startup handshake stalls under x64 Node emulation on Windows ARM64.

- [#180](https://github.com/Gorce-AI/termwright/pull/180) [`389c4de`](https://github.com/Gorce-AI/termwright/commit/389c4de2a6706a2869955295d53c95f00ac63c46) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Build the Win32 observable-resize certification fixture ahead of the measured ConPTY session. This removes runtime C# compilation from the startup handshake proof and makes x64-on-ARM64 certification depend only on terminal events.
- Updated dependencies []:
  - @termwright/protocol@0.7.4

## 0.7.3

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.7.3

## 0.7.2

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [[`98e5463`](https://github.com/Gorce-AI/termwright/commit/98e5463686ae15bf0cea32fb020e9d3ba3e7edaa)]:
  - @termwright/protocol@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`454a662`](https://github.com/Gorce-AI/termwright/commit/454a6625619565f23b48b5e1af345e06c4f55a00)]:
  - @termwright/protocol@0.6.0

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.5.1

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace misleading generic owned-process RSS/count fields with capability-qualified whole-tree accounting. Windows sessions now capture cumulative Job Object CPU, memory, process, and I/O counters before disposal; run manifest v8 preserves their native meanings and reports unsupported platforms as unavailable.

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.3.2

## 0.3.1

### Patch Changes

- [#122](https://github.com/Gorce-AI/termwright/pull/122) [`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Transfer ownership of the Go client's evidence-provider lease exactly once when concurrent socket and publication shutdown paths close the same session. Preserve complete race-detector diagnostics from the full tview PTY certification instead of relying on terminal-screen text that the detector does not write.

  Deliver each Windows application terminal reply through the private `twh-app-reply-v1` envelope. Patched OpenConsole buffers the complete OSC, validates its length and encoding, then commits the decoded reply in one input-buffer operation regardless of the child's VT-input mode. This prevents both per-byte mode-report corruption and raw CPR consumption as an F3 key.

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1

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

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Return the canonical Go module directory required as the instrumented build cwd, preserve the caller's effective workspace, and fail closed when Charm instrumentation would replace a vendored dependency graph.

  Keep Linux process-group teardown authoritative when an unrelated `/proc` entry disappears during the owned-tree scan.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Filter Linux process-group candidates before opening pidfds, preserve the
  post-open identity check, and surface native lifecycle errno diagnostics with
  open-file-limit guidance instead of reporting an unproven live process tree.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
  cursor synchronization uses a private request-addressed OpenConsole RPC, and
  ordinary application replies use Win32 Input Mode instead of surfacing as key
  presses.
  Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
  flush cannot race recovery bookkeeping and leave the semantic revision stale.
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/protocol@0.3.0
