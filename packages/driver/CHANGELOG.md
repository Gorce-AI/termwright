# @termwright/driver

## 0.3.0

### Minor Changes

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: narrow the supported driver root to application-facing terminal,
  locator, action, observation, value-policy, and error APIs. Low-level PTY
  backends, key/mouse encoders, selector parsers, process supervision, inherited
  environment construction, and launch-resource injection now live exclusively
  under `@termwright/driver/experimental`. The pre-stable API has no compatibility
  re-exports or deprecated aliases.

- [#44](https://github.com/Gorce-AI/termwright/pull/44) [`e760f91`](https://github.com/Gorce-AI/termwright/commit/e760f9126caa8166078289b64845ca03e3889cf6) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace node-pty and the separate ConPTY loader with one Termwright-owned native
  PTY backend that provides authoritative output EOF and owned process trees on
  all supported platforms. Native input admission and native-to-JavaScript output
  delivery are bounded and backpressured; overflow, write failure, missing Windows
  completion-port support, and missing platform addons fail closed.

- [#45](https://github.com/Gorce-AI/termwright/pull/45) [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Expose and validate per-run semantic probe intervention metadata, including the
  engaged injection tier, geometry class, and named degraded capabilities. The
  effective session contract and Runner now preserve those facts so reduced
  framework coverage cannot silently look complete.

  Add the generic Go `-toolexec` path for compiler-checked, add-only package units.
  tview and Bubbles builds reuse a content-addressed compiler identity across
  temporary materialisation directories while invalidating it for changed owned
  sources or injected import archives.
  tview now uses one dormant application attachment plus public draw hooks and
  owned tview/tcell units without copying or patching upstream modules. Bubbles
  private-state readers use the same mechanism, while Bubble Tea retains only the
  exact model and render-flush hooks required for causal semantic publication.

  OpenTUI moves semantic geometry and hit-grid observation to runtime hooks while
  retaining its narrow structural native-output transform. Ink includes the
  composable React commit bridge and differential evidence explaining why exact
  renderer instrumentation remains necessary for full fidelity.

  Ratatui now sizes its asynchronous publication queue from the negotiated
  semantic in-flight limit instead of a scheduler-sensitive hard-coded value.
  `terminal.launch({ semanticFrameQueueCapacity })` can raise that bounded limit
  for intentional synchronous render bursts, and an exact overflow diagnostic
  reports the active budget and an actionable remediation.

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

- [#26](https://github.com/Gorce-AI/termwright/pull/26) [`fc625dc`](https://github.com/Gorce-AI/termwright/commit/fc625dc903327833a75a1491158a2e4d57c2d9e0) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Separate adapter discovery from the bounded hello handshake so a peer accepted before discovery closes can authenticate deterministically, while capping active semantic sockets and refusing late peers fail-closed. Keep process cleanup deadlines in the same lazy monotonic-clock domain as their session so launch rollback remains bounded and reliable across supported Node runtimes.

- [#47](https://github.com/Gorce-AI/termwright/pull/47) [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make local endpoint shutdown a causal barrier on Windows and POSIX. Accepted semantic sockets are now destroyed before listener completion, late connections are rejected during shutdown, and listener cleanup still completes when an individual socket teardown reports an error.

- [#68](https://github.com/Gorce-AI/termwright/pull/68) [`9dfeaf9`](https://github.com/Gorce-AI/termwright/commit/9dfeaf9a6e5778ee03eb82ea3287748beffc58d4) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Close emulator-generated terminal-response forwarding at the causal process
  tree and PTY-input boundaries. Delayed xterm replies can no longer race native
  Windows PTY disposal, while real response-write failures remain explicit
  infrastructure failures.

- [#61](https://github.com/Gorce-AI/termwright/pull/61) [`54bdd45`](https://github.com/Gorce-AI/termwright/commit/54bdd454f05d9510bba991ffe745c3b31f5db74d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make action observation waits causal across independent Windows semantic and
  PTY transports: pending frames arm before inspection and wake on lifecycle
  transitions. Close adapter probe artifacts only after endpoint admission, the
  owned process tree, authoritative output EOF, and terminal parser drain have
  all completed.

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Decompose terminal sessions into independently tested process, evidence,
  action, input-barrier, and semantic-contract units, and split the persistent
  test host into explicit coordination, Vitest-adapter, and persistence/finalizer
  components. Public behavior, event ordering, teardown, and failure semantics
  remain unchanged.

- [#47](https://github.com/Gorce-AI/termwright/pull/47) [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Filter Linux process-group candidates before opening pidfds, preserve the
  post-open identity check, and surface native lifecycle errno diagnostics with
  open-file-limit guidance instead of reporting an unproven live process tree.

- [#104](https://github.com/Gorce-AI/termwright/pull/104) [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve ConPTY terminal-query provenance: host control replies remain raw,
  cursor synchronization uses a private request-addressed OpenConsole RPC, and
  ordinary application replies use Win32 Input Mode instead of surfacing as key
  presses.
  Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
  flush cannot race recovery bookkeeping and leave the semantic revision stale.

- [#5](https://github.com/Gorce-AI/termwright/pull/5) [`2272a13`](https://github.com/Gorce-AI/termwright/commit/2272a13016ee42e054a43015489712ee006e564d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Expose locator retry waits through a structured `action-observation-wait`
  diagnostic. Its `actionId` correlates the wait with the action lifecycle, while
  `observationState` identifies the exact in-flight parser, semantic-frame, or
  render-pairing boundary that must settle before input can be sent.

- [#10](https://github.com/Gorce-AI/termwright/pull/10) [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Roll back partially acquired semantic and Ink control endpoints when
  Unix-socket or Windows named-pipe listener startup fails, including
  deterministic cleanup-error reporting instead of leaking endpoint lifecycles.

- [#11](https://github.com/Gorce-AI/termwright/pull/11) [`0c715f1`](https://github.com/Gorce-AI/termwright/commit/0c715f1d9bfb3087973a1278fc71ee6acf305855) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Keep shared probe build outputs immutable while the Native Host is running,
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

- [#13](https://github.com/Gorce-AI/termwright/pull/13) [`7cac416`](https://github.com/Gorce-AI/termwright/commit/7cac4160c94868448c74e9b09ed7c082a2f3ef26) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve native ConPTY output, exit evidence, and the first fatal I/O error
  emitted before the terminal journal attaches, and make managed PowerShell
  readiness a causal startup marker instead of a quiet-window input race.

  Load screenshot fallback fonts only when a requested glyph needs them and keep
  the shared parsed-face cache bounded and file-identity-aware. ASCII screenshots
  no longer eagerly parse Windows CJK and emoji collections, while style,
  fallback, and colour-emoji fidelity remain unchanged.

- Updated dependencies [[`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e)]:
  - @termwright/protocol@0.3.0
  - @termwright/vt@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/vt@0.2.0
