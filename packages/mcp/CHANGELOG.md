# @termwright/mcp

## 0.7.5

### Patch Changes

- [#181](https://github.com/Gorce-AI/termwright/pull/181) [`b4dbadf`](https://github.com/Gorce-AI/termwright/commit/b4dbadfeae74a818c8b7cd6cc16cbd310b276241) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Accept recorder-produced multi-kilobyte input events in reports. Make recorded MCP terminal cleanup idempotent across retries and server restarts, keep untargeted `terminal.type` on the current focus, and add `probe: "opentui"` launch injection for Bun and Node applications.
- Updated dependencies [[`7903552`](https://github.com/Gorce-AI/termwright/commit/7903552aa6c83b3b721af82321d8a4aa5fb73714), [`b4dbadf`](https://github.com/Gorce-AI/termwright/commit/b4dbadfeae74a818c8b7cd6cc16cbd310b276241)]:
  - @termwright/probe-opentui@0.7.5
  - @termwright/trace@0.7.5
  - @termwright/driver@0.7.5
  - @termwright/protocol@0.7.5
  - @termwright/screenshot@0.7.5

## 0.7.4

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.7.4
  - @termwright/screenshot@0.7.4
  - @termwright/trace@0.7.4
  - @termwright/protocol@0.7.4

## 0.7.3

### Patch Changes

- [#175](https://github.com/Gorce-AI/termwright/pull/175) [`ea57684`](https://github.com/Gorce-AI/termwright/commit/ea5768429a3fd2d6b0e0d7433b58a4e7f0ebce70) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Open the MCP browser monitor with the first terminal and close its owned browser
  process after the last terminal closes. Preserve styled terminal cells, cursor
  state, live multi-terminal switching, and fit the complete grid into the monitor
  viewport with fullscreen and manual zoom controls.
- Updated dependencies []:
  - @termwright/driver@0.7.3
  - @termwright/protocol@0.7.3
  - @termwright/screenshot@0.7.3
  - @termwright/trace@0.7.3

## 0.7.2

### Patch Changes

- [#173](https://github.com/Gorce-AI/termwright/pull/173) [`3d3e8d5`](https://github.com/Gorce-AI/termwright/commit/3d3e8d53634ac6a529d9f00ca6c1a3f44db824b3) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Add abortable driver waits, durable revision-driven MCP watchers, and a local
  browser monitor for live terminal screens, semantic trees, and watcher state.
- Updated dependencies [[`3d3e8d5`](https://github.com/Gorce-AI/termwright/commit/3d3e8d53634ac6a529d9f00ca6c1a3f44db824b3)]:
  - @termwright/driver@0.7.2
  - @termwright/screenshot@0.7.2
  - @termwright/trace@0.7.2
  - @termwright/protocol@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [[`98e5463`](https://github.com/Gorce-AI/termwright/commit/98e5463686ae15bf0cea32fb020e9d3ba3e7edaa)]:
  - @termwright/protocol@0.7.1
  - @termwright/driver@0.7.1
  - @termwright/screenshot@0.7.1
  - @termwright/trace@0.7.1

## 0.7.0

### Minor Changes

- [#167](https://github.com/Gorce-AI/termwright/pull/167) [`2a88141`](https://github.com/Gorce-AI/termwright/commit/2a881417adfde7da4f76a1ad8baabdd1ecd0992d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Record manual MCP terminal sessions as bounded redacted traces, return the replay path on close, prioritize active modal and focused controls in compact snapshots, and support subtree snapshots. Correct screenshot redaction when public modal text covers a sensitive field, expose exact redaction metadata, add physical cell clicks for composite controls, and clarify query, action, and emulator selection semantics for agents.

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.7.0
  - @termwright/protocol@0.7.0
  - @termwright/screenshot@0.7.0
  - @termwright/trace@0.7.0

## 0.6.0

### Minor Changes

- [#163](https://github.com/Gorce-AI/termwright/pull/163) [`454a662`](https://github.com/Gorce-AI/termwright/commit/454a6625619565f23b48b5e1af345e06c4f55a00) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Add revision-driven `waitUntil` and focus traversal, explicit keyboard or pointer action routing, and Kitty progressive keyboard support. Timeout errors now explain pending observation evidence and include the last observed value.

  Add abort-aware, exactly-once fixture resource scopes and managed sidecar processes. Gherkin scenarios can map tags to timeouts and resources, and receive the same scoped lifecycle.

  Keep literal test IDs intact, stop treating named control keys as trace secrets, and expose OpenTUI text only when the concrete renderer prototype proves it is read-only.

### Patch Changes

- Updated dependencies [[`454a662`](https://github.com/Gorce-AI/termwright/commit/454a6625619565f23b48b5e1af345e06c4f55a00)]:
  - @termwright/driver@0.6.0
  - @termwright/protocol@0.6.0
  - @termwright/trace@0.6.0
  - @termwright/screenshot@0.6.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`b5acff2`](https://github.com/Gorce-AI/termwright/commit/b5acff24a384cb37df4b46a8bfdd3a3753a20c57)]:
  - @termwright/driver@0.5.3
  - @termwright/screenshot@0.5.3
  - @termwright/trace@0.5.3
  - @termwright/protocol@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.5.2
  - @termwright/protocol@0.5.2
  - @termwright/screenshot@0.5.2
  - @termwright/trace@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [[`a547d82`](https://github.com/Gorce-AI/termwright/commit/a547d826a5bb71c76eb0a9293e1444acd5fbf9d8)]:
  - @termwright/trace@0.5.1
  - @termwright/driver@0.5.1
  - @termwright/protocol@0.5.1
  - @termwright/screenshot@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [[`3d0d95f`](https://github.com/Gorce-AI/termwright/commit/3d0d95ff3980bb8d656bcad2c3656d6ea6e0ffda), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2), [`5b395b5`](https://github.com/Gorce-AI/termwright/commit/5b395b5c630894ed2f5e47babdd4ae2c032fc9c2)]:
  - @termwright/driver@0.5.0
  - @termwright/screenshot@0.5.0
  - @termwright/trace@0.5.0
  - @termwright/protocol@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.4.1
  - @termwright/protocol@0.4.1
  - @termwright/screenshot@0.4.1
  - @termwright/trace@0.4.1

## 0.4.0

### Minor Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace the scalar artifact value option with one secure policy, sanitize every
  Trace v4 stream before temporary persistence, and mask sensitive screenshot
  cells before rasterisation.

### Patch Changes

- [#132](https://github.com/Gorce-AI/termwright/pull/132) [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Replace protocol v2 full-snapshot publication with protocol v3 semantic
  keyframes, revision-based domain deltas, explicit resynchronization, and
  incrementally maintained locator indexes. The driver projects framed input
  once, applies deltas atomically, and retains the last committed state after any
  invalid update. All built-in TypeScript, Go, Python, and Rust producers now
  speak only the new protocol.
- Updated dependencies [[`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd), [`712018f`](https://github.com/Gorce-AI/termwright/commit/712018fdaed300ff233949c611b2ac0f93e399dd)]:
  - @termwright/protocol@0.4.0
  - @termwright/driver@0.4.0
  - @termwright/trace@0.4.0
  - @termwright/screenshot@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/driver@0.3.2
  - @termwright/protocol@0.3.2
  - @termwright/screenshot@0.3.2
  - @termwright/trace@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`a268cf4`](https://github.com/Gorce-AI/termwright/commit/a268cf42aa880353e3f307112dbbbfebc492212c)]:
  - @termwright/protocol@0.3.1
  - @termwright/driver@0.3.1
  - @termwright/screenshot@0.3.1
  - @termwright/trace@0.3.1

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/driver@0.3.0
  - @termwright/protocol@0.3.0
  - @termwright/screenshot@0.3.0
  - @termwright/trace@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`a3cbc2b`](https://github.com/Gorce-AI/termwright/commit/a3cbc2b4d787b255062356a18cbf5509f7108460)]:
  - @termwright/protocol@0.2.0
  - @termwright/driver@0.2.0
  - @termwright/screenshot@0.2.0
  - @termwright/trace@0.2.0
