# @termwright/pty-darwin-x64

## 0.5.0

## 0.4.1

## 0.4.0

## 0.3.2

## 0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace node-pty and the separate ConPTY loader with one Termwright-owned native
  PTY backend that provides authoritative output EOF and owned process trees on
  all supported platforms. Native input admission and native-to-JavaScript output
  delivery are bounded and backpressured; overflow, write failure, missing Windows
  completion-port support, and missing platform addons fail closed.
