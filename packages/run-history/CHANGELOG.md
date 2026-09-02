# @termwright/run-history

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/protocol@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
  verdict across the Native Host, journal, CLI, history, and Runner. A partial
  skip exits successfully only when every observed skip and selected required
  declaration matches the repository's exact reviewed policy; undeclared,
  ambiguous, all-skipped, and stale-required cases remain non-certifying.

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Document the public installation, lifecycle, durability, authentication, and
  security contracts of the desktop host and native-host infrastructure packages.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep shared probe build outputs immutable while the Native Host is running,
  with a pre-host content fingerprint that builds missing fresh-clone inputs,
  rebuilds stale inputs, and rejects source or artifact changes inside test
  workers. Settle deadline, process-exit and Ink render race branches during
  teardown. A cancelled desktop control bind now remains owned until a late
  listener is closed, so startup rollback cannot leave an orphaned socket or
  named pipe. Promote Vitest
  async-handle leak evidence into a non-certifying infrastructure result.

  Compare exact reference and candidate revisions on one macOS runner in a fixed
  reference/candidate/candidate/reference sequence. The paired gate binds the
  toolchain, measurement harness, controller, round order, subject commit, CI
  attempt and every raw report with SHA-256 provenance; Bun/OpenTUI is mandatory,
  and process and file-descriptor leaks remain exact-zero invariants.

  Move native run manifests to schema v3 with host-monotonic total duration and
  per-attempt start/finish offsets. Validate those intervals against the run
  boundary and reject v2 or internally inconsistent timing evidence.

  The independent Windows Vitest/PTY reliability harness now invokes the exact
  lockfile-backed Vitest entry point directly through Node instead of relying on
  non-executable `.cmd` shell shims.

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
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/protocol@0.3.0
