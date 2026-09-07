# @termwright/ui

## 0.5.1

### Patch Changes

- [#152](https://github.com/Gorce-AI/termwright/pull/152) [`a547d82`](https://github.com/Gorce-AI/termwright/commit/a547d826a5bb71c76eb0a9293e1444acd5fbf9d8) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Switch completed native test attempts to replay as soon as their retained recording is finalized, including failed attempts and retries. Attempts without a recording continue to report its absence.

  Improve the replay timeline with previous/next step controls, millisecond time labels, precise endpoints, keyboard seeking, and aligned markers on small screens. Hover previews now keep the terminal and semantic inspector at the same moment. Selecting cases preserves replay position, nested step keyboard navigation stays within the narrative, and crash notices leave player controls reachable.

  Group the searchable test list by source file, with compact single-line test titles and the selected test's steps expanded directly underneath its row. Show each file name once per group and avoid repeating the test title in its details. Filter failed tests, read full step titles, and expand successful Gherkin commands on demand. Failures surface above the narrative with a direct jump to the failing command and its complete error; retry and technical details remain available without crowding the overview. Progress counts named steps once, and collapsing a test preserves its playhead.

  Keep collapsed step rows on one line, with their source location and action/assertion counts available in a pointer- and keyboard-accessible tooltip instead of a separate metadata row.

  Record ordinary Jest-style expectations as assertion rows alongside terminal matchers, in live sessions and retained traces. Preserve negation, promise and soft outcomes, collapse polling into its final result, and retain locator evidence without duplicate rows. Add retrying `toHaveCount`, with an explicit explanation for empty or non-unique matches. Assertion targets can be previewed and pinned; primitive comparisons do not invent selectors. Explain missing evidence in older recordings.

  Move collapsed panel handles to their own workspace edges and move terminal expansion into a quiet icon in the terminal toolbar. Keep layout controls separate from the test outcome. Escape restores the previous panel layout; compact screens use their workspace tabs without duplicate layout controls.

  Add element picking directly on live and replay terminal screens. Hover highlights recorded semantic bounds; click reveals the element in its tree and opens its details, restoring a hidden inspector on desktop or mobile. Pause playback for selection, support arrows/Enter/Escape, and keep inspection input separate from terminal input. Associate asynchronous tree responses with the requested playhead to reject stale data, including moments between terminal output events.

  Drain terminal writes and pending viewport reset callbacks before disposing a replaced emulator, preventing renderer errors during repeated Unicode profile changes.

  Improve the remaining Runner workspace workflows: run exact search matches from the catalog, clear searches, and dismiss the New test menu with Escape, outside clicks or keyboard navigation. Distinguish loading, empty and failed history requests; refresh and search retained runs, retain mobile result labels and use consistent outcome colors. Show recording availability once per run.

  Add text and explicit severity filters for application logs without inferring severity from plain file messages. Hide live actionability in replay details and report successful or unavailable clipboard writes across inspector fields, diagnostics, source links and generated tests. Share modal focus management with settings confirmations, including Escape cancellation, focus containment and return to the trigger.

  Replay retained run attempts directly from history using exact finalized references in the committed event journal. Restore historical replay deep links after reload, explain unavailable archives, and compare failed and passed attempts in independent terminal panels aligned by named steps or outcome. Show semantic field differences without matching ephemeral node IDs or ambiguous identities.

  Search the semantic tree by role, name, test ID or ref, reveal matching ancestors and navigate matches with keyboard or pointer while keeping terminal highlights aligned. Preserve recorder drafts when closing review and after refreshing the page; reopen them from navigation, edit the save destination and protect newer drafts from stale tabs. Drafts remain available for the lifetime of the Runner server.

- Updated dependencies [[`a547d82`](https://github.com/Gorce-AI/termwright/commit/a547d826a5bb71c76eb0a9293e1444acd5fbf9d8)]:
  - @termwright/trace@0.5.1
  - @termwright/driver@0.5.1
  - @termwright/protocol@0.5.1
  - @termwright/run-history@0.5.1
  - @termwright/vt@0.5.1

## 0.5.0

### Minor Changes

- [#145](https://github.com/Gorce-AI/termwright/pull/145) [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove an unused UI provider facade and rename the Ink probe's required advanced
  instrumentation entry point so no published subpath pretends an internal API is
  a supported user contract. Terminal profile options now accept only the two
  registered behavior profiles and configuration rejects unknown ids eagerly.

### Patch Changes

- Updated dependencies [[`3d0d95f`](https://github.com/Gorce-AI/termwright/commit/3d0d95ff3980bb8d656bcad2c3656d6ea6e0ffda), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2)]:
  - @termwright/driver@0.5.0
  - @termwright/run-history@0.5.0
  - @termwright/trace@0.5.0
  - @termwright/protocol@0.5.0
  - @termwright/vt@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.4.1
  - @termwright/protocol@0.4.1
  - @termwright/run-history@0.4.1
  - @termwright/trace@0.4.1
  - @termwright/vt@0.4.1

## 0.4.0

### Minor Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Publish exact streaming trace resource counters, including each writer's private staging-disk high-water, through authoritative run events and require run manifest v7 to reconstruct their aggregates independently.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the scalar artifact value option with one secure policy, sanitize every
  Trace v4 stream before temporary persistence, and mask sensitive screenshot
  cells before rasterisation.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace finalize-heavy embedded run events with manifest v5 and an append-only,
  independently checksummed `events.ndjson` stream. Keep live event projections
  bounded while canonical history is written batch by batch.

### Patch Changes

- [#134](https://github.com/Gorce-AI/termwright/pull/134) [`9f7e024`](https://github.com/Gorce-AI/termwright/commit/9f7e024c09c6d6ee401523cda4ffb4261891aed2) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Drain the browser terminal write queue before disposing a terminal generation during profile changes.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the Unicode 11 terminal model and branded profile aliases with one
  Unicode 15 extended-grapheme provider and explicit `default`/`cjk-wide`
  terminal policies. Runner rendering now uses exactly the same provider as live
  sessions and replay, including when the selected profile changes.
- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/run-history@0.4.0
  - @termwright/driver@0.4.0
  - @termwright/trace@0.4.0
  - @termwright/vt@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.3.2
  - @termwright/protocol@0.3.2
  - @termwright/run-history@0.3.2
  - @termwright/trace@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/driver@0.3.1
  - @termwright/run-history@0.3.1
  - @termwright/trace@0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
  verdict across the Native Host, journal, CLI, history, and Runner. A partial
  skip exits successfully only when every observed skip and selected required
  declaration matches the repository's exact reviewed policy; undeclared,
  ambiguous, all-skipped, and stale-required cases remain non-certifying.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Harden live HTTP and Runner boundaries with per-launch MCP bearer
  authentication, exact Origin policy, explicit non-loopback opt-in, bounded
  authenticated and preflight rate limits, and opt-in token disclosure.

  Runner viewers and producers now use separate credentials. Producer ownership
  is bound to a run generation, semantic snapshots are validated at ingress, and
  UTF-8 replay/client queues have strict byte ceilings with deterministic
  disconnect and cleanup behavior.

  The Runner now commits its HTTP snapshot before subscribing to the replaying
  WebSocket. Live session and semantic events therefore cannot be overwritten by
  a slower bootstrap response.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Add shared ARIA tree navigation to the Semantic Inspector and Specs catalogue:
  one roving tab stop, Up/Down/Home/End traversal, Left/Right branch navigation,
  and focus and selection retention across live re-renders.

  Runner URLs now retain the active view, run, execution, trace, and replay
  position across refresh and Back/Forward. Authentication is removed from the
  address before React starts and remains tab-scoped rather than becoming part of
  a copied deep link or browser history state.

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Expose and validate per-run semantic probe intervention metadata, including the
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

### Patch Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Remove migration of pre-release Runner preference keys. The Runner now reads
  only its current versioned preference storage and otherwise starts from fresh
  defaults, without retaining compatibility paths for unpublished schemas.
- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/run-history@0.3.0
  - @termwright/trace@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.2.0
  - @termwright/trace@0.2.0
