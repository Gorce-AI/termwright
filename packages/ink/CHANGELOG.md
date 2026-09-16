# @termwright/ink

## 0.7.1

### Patch Changes

- Updated dependencies [[`98e5463`](https://github.com/Gorce-AI/termwright/commit/98e5463686ae15bf0cea32fb020e9d3ba3e7edaa)]:
  - @termwright/protocol@0.7.1
  - @termwright/driver@0.7.1
  - @termwright/probe-ink@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.7.0
  - @termwright/probe-ink@0.7.0
  - @termwright/protocol@0.7.0

## 0.6.0

### Minor Changes

- [#163](https://github.com/Gorce-AI/termwright/pull/163) [`454a662`](https://github.com/Gorce-AI/termwright/commit/454a6625619565f23b48b5e1af345e06c4f55a00) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Add revision-driven `waitUntil` and focus traversal, explicit keyboard or pointer action routing, and Kitty progressive keyboard support. Timeout errors now explain pending observation evidence and include the last observed value.

  Add abort-aware, exactly-once fixture resource scopes and managed sidecar processes. Gherkin scenarios can map tags to timeouts and resources, and receive the same scoped lifecycle.

  Keep literal test IDs intact, stop treating named control keys as trace secrets, and expose OpenTUI text only when the concrete renderer prototype proves it is read-only.

### Patch Changes

- Updated dependencies [[`454a662`](https://github.com/Gorce-AI/termwright/commit/454a6625619565f23b48b5e1af345e06c4f55a00)]:
  - @termwright/driver@0.6.0
  - @termwright/protocol@0.6.0
  - @termwright/probe-ink@0.6.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`b5acff2`](https://github.com/Gorce-AI/termwright/commit/b5acff24a384cb37df4b46a8bfdd3a3753a20c57)]:
  - @termwright/driver@0.5.3
  - @termwright/probe-ink@0.5.3
  - @termwright/protocol@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.5.2
  - @termwright/probe-ink@0.5.2
  - @termwright/protocol@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.5.1
  - @termwright/probe-ink@0.5.1
  - @termwright/protocol@0.5.1

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace misleading generic owned-process RSS/count fields with capability-qualified whole-tree accounting. Windows sessions now capture cumulative Job Object CPU, memory, process, and I/O counters before disposal; run manifest v8 preserves their native meanings and reports unsupported platforms as unavailable.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove an unused UI provider facade and rename the Ink probe's required advanced
  instrumentation entry point so no published subpath pretends an internal API is
  a supported user contract. Terminal profile options now accept only the two
  registered behavior profiles and configuration rejects unknown ids eagerly.

### Patch Changes

- Updated dependencies [[`3d0d95f`](https://github.com/Gorce-AI/termwright/commit/3d0d95ff3980bb8d656bcad2c3656d6ea6e0ffda), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2)]:
  - @termwright/driver@0.5.0
  - @termwright/probe-ink@0.5.0
  - @termwright/protocol@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.4.1
  - @termwright/probe-ink@0.4.1
  - @termwright/protocol@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/driver@0.4.0
  - @termwright/probe-ink@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.3.2
  - @termwright/probe-ink@0.3.2
  - @termwright/protocol@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/driver@0.3.1
  - @termwright/probe-ink@0.3.1

## 0.3.0

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Certify upstream framework releases: bubbles-v1@v1.0.0, bubbles-v2@v2.1.1, bubbles-v2@v2.2.0, bubbles-v2@v2.2.1, bubbletea-v1@v1.3.10, bubbletea-v2@v2.0.8, bubbletea-v2@v2.0.9, ink@7.1.1, opentui@0.5.3, opentui@0.5.4, opentui@0.5.6, opentui@0.5.7, opentui@0.5.8, opentui@0.5.9, ratatui-core@0.1.2, ratatui-crossterm@0.1.2, ratatui-widgets@0.3.2, tcell-v2@v2.10.0, tcell-v2@v2.11.0, tcell-v2@v2.12.0, tcell-v2@v2.12.1, tcell-v2@v2.12.2, tcell-v2@v2.13.0, tcell-v2@v2.13.1, tcell-v2@v2.13.10, tcell-v2@v2.13.2, tcell-v2@v2.13.3, tcell-v2@v2.13.4, tcell-v2@v2.13.5, tcell-v2@v2.13.6, tcell-v2@v2.13.7, tcell-v2@v2.13.8, tcell-v2@v2.13.9, tcell-v2@v2.8.1, tcell-v2@v2.9.0, textual@8.2.8, tview@v0.42.0.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Roll back partially acquired semantic and Ink control endpoints when
  Unix-socket or Windows named-pipe listener startup fails, including
  deterministic cleanup-error reporting instead of leaking endpoint lifecycles.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Bind fixture rerender acknowledgements to the exact committed Ink host generation and add command identities so stale render callbacks or late control replies cannot acknowledge a newer rerender. Authenticate control peers before electing the fixture connection and isolate bounded per-peer input so strangers cannot reserve or poison the channel.
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/probe-ink@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
  - @termwright/probe-ink@0.2.0
