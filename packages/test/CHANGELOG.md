# @termwright/test

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make `hostPressure: 'exclusive'` reserve the host's complete weighted capacity, and let already-active attempts acquire fitting continuation resources ahead of blocked new attempts. New attempts remain FIFO, while dynamic terminal acquisition can no longer deadlock behind a waiter that needs the active attempt's resources.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace misleading generic owned-process RSS/count fields with capability-qualified whole-tree accounting. Windows sessions now capture cumulative Job Object CPU, memory, process, and I/O counters before disposal; run manifest v8 preserves their native meanings and reports unsupported platforms as unavailable.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove the public resource-broker Vitest subpath and its optional Vitest peer. Resource-aware declarations now belong exclusively to Termwright's embedded test surface, and adapter conformance uses that same owned engine instead of resolving a consumer Vitest.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove an unused UI provider facade and rename the Ink probe's required advanced
  instrumentation entry point so no published subpath pretends an internal API is
  a supported user contract. Terminal profile options now accept only the two
  registered behavior profiles and configuration rejects unknown ids eagerly.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Bound worker event production before deferred transport work is created. Hot-path events now use synchronous count-and-byte admission and an explicit drain barrier, so a slow or failed journal sink cannot create an unbounded Promise chain or hide authoritative delivery failure.

### Patch Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Physically isolate Termwright's certified Vitest 4 engine from a consumer's Vitest installation, including npm 10 installs alongside Vitest 5. Make `termwright doctor` inspect that embedded engine, and keep Gherkin definitions coupled only to Termwright's public test API.

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep POSIX shell command tracking authoritative when an interactive shell enables `errexit`, so failed commands still emit their completion boundary and return an exit status instead of timing out. Generic terminal resize receipts no longer misclassify arbitrary later PTY bytes as proof of an application repaint; paired render evidence is reported only when a semantic adapter can prove it.
- Updated dependencies [[`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2)]:
  - @termwright/resource-broker@0.5.0
  - @termwright/driver@0.5.0
  - @termwright/ui@0.5.0
  - @termwright/run-journal-transport@0.5.0
  - @termwright/trace@0.5.0
  - @termwright/protocol@0.5.0
  - @termwright/vt@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.4.1
  - @termwright/protocol@0.4.1
  - @termwright/resource-broker@0.4.1
  - @termwright/run-journal-transport@0.4.1
  - @termwright/trace@0.4.1
  - @termwright/ui@0.4.1

## 0.4.0

### Minor Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Require capability-aware resource telemetry in native run manifest v6, expose
  bounded journal admission metrics, and report unavailable capabilities without
  fabricated zeroes.
  Attempt finalization now publishes measured worker-process CPU and sampled peak
  RSS; manifest v6 validates and aggregates that evidence.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Publish exact streaming trace resource counters, including each writer's private staging-disk high-water, through authoritative run events and require run manifest v7 to reconstruct their aggregates independently.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep Vitest behind one private engine adapter, finalize concrete attempts through
  the public `onAfterRetryTask` lifecycle hook, and remove the runner and engine
  subpath exports.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Resolve worker and terminal admission from cgroup-aware CPU, memory, and temp
  disk budgets, and atomically schedule every attempt with CPU/memory/I/O weights.
  Use a bounded local p50/p95/EWMA cache to raise memory admission from measured
  worker RSS while retaining conservative defaults for new tests.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the finalize-buffered trace format with Trace v4: bounded append-only
  spooling, incremental checksums, raw monotonic timestamps with lazy presentation
  mapping, semantic keyframes and deltas, secure async disposal, and streaming
  portable packaging. Previous Termwright trace formats are intentionally not
  readable.

### Patch Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.
- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`9f7e024`](https://github.com/Gorce-AI/termwright/commit/9f7e024c09c6d6ee401523cda4ffb4261891aed2), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/run-journal-transport@0.4.0
  - @termwright/driver@0.4.0
  - @termwright/ui@0.4.0
  - @termwright/trace@0.4.0
  - @termwright/resource-broker@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.3.2
  - @termwright/protocol@0.3.2
  - @termwright/resource-broker@0.3.2
  - @termwright/run-journal-transport@0.3.2
  - @termwright/trace@0.3.2
  - @termwright/ui@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/driver@0.3.1
  - @termwright/resource-broker@0.3.1
  - @termwright/run-journal-transport@0.3.1
  - @termwright/trace@0.3.1
  - @termwright/ui@0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: replace the pre-release `test.scoped()` fixture-composition API with
  Vitest 4.1's `test.override()` API, without a compatibility alias.

  Gherkin-generated tests can now request typed custom fixtures from the same
  `test.extend()` runtime used by ordinary Vitest tests. Custom fixtures may
  depend on Termwright fixtures, keep native async setup/teardown ordering, and
  work through a custom `generatedImports.test` module.

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep the local Native Host profile at two Vitest forks while retaining capacity
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
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
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
