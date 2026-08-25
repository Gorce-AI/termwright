# Repo audit for the zero-config instrumentation campaign (Phase 0)

> **Historical Phase 0 evidence.** This snapshot intentionally retains the
> repository layout and APIs that existed before the injected probes shipped.
> Current setup and support status live in the website adapter guides and
> compatibility reference; do not use this file as migration guidance.

Scope: what exists today, what it costs, and which constraints Phase 1 has to
design against. No proposals for the final Probe IR — facts, verdicts and
limits only.

Method note: everything marked **measured** comes from a probe or a CI run in
this repository and is cited. Everything else is read from source with a file
path. Where the two disagreed during this campaign's predecessors, the
measurement won — twice against a plausible story that turned out to be wrong
(see §2.3).

Verdict vocabulary used in the tables:

- **foundation** — survives as-is under the Probe IR; changing it would cost
  more than it returns.
- **rework** — the mechanism is right, the shape or placement is wrong.
- **delete** — replaced outright once the probe model lands.

---

## 1. Inventory

### 1.1 Protocol (`packages/protocol/src`)

| Component | Where | Verdict | Why |
|---|---|---|---|
| Framing: 4-byte BE length + UTF-8 JSON | `framing.ts` | **foundation** | Transport-agnostic, already hostile-input hardened |
| `projectDto` DTO projection | `framing.ts:365` | **foundation** | The whole prototype/getter/alias/cycle defence lives here |
| Message envelopes | `messages.ts` | **rework** | Shape survives, vocabulary changes (§4) |
| Strict vs tolerant reader split | `messages.ts:377/460` | **foundation** | Adapter input strict, driver input tolerant — keep the asymmetry |
| Render marker | `marker.ts` | **foundation, conditional** | See §2 — this is the campaign's sharpest question |
| `TreeDelta` + `applyTreeDelta` | `delta.ts` | **foundation** | Semantics carry over to IR facts unchanged (§3.4) |
| Limits | `limits.ts` | **foundation** | Only `maxNodes`/`maxDepth` need re-reading against progressive levels |
| Fixed role vocabulary (23) | `roles.ts:5` | **rework** | Closed set contradicts "unknown widget = generic node, never disappears" (§5, Q1) |
| Fixed action vocabulary (7) | `roles.ts:34` | **foundation** | Descriptive hints, not endpoints; nothing in the new model needs more |
| `SemanticState` closed record | `tree.ts:12` | **rework** | Provenance is per-property (spec b) and this type has nowhere to carry it |
| AccessKit export | `accesskit.ts` | **foundation** | Independent consumer of the model, useful as an external correctness check |
| Env + token | `env.ts` | **foundation** | Token is an opaque UTF-8 string end to end — that property is what keeps Python/Go/Rust interoperable |

Detail worth carrying into Phase 1: **the delta model cannot express "unset a
field"** (`delta.ts:11-31` — `changed` replaces a node wholesale) and **cannot
clear the cursor**. A producer must send a full snapshot when a field goes
away. Any IR that emits per-property facts with provenance inherits this
question immediately, and more sharply: retracting a fact is a normal event
when a recognizer loses confidence, not an edge case.

### 1.2 Driver (`packages/driver/src`)

| Component | Where | Verdict | Why |
|---|---|---|---|
| PTY backend abstraction | `pty.ts` | **foundation** | Already the seam that isolates ConPTY; probes need the same seam |
| `VtScreen` + `@termwright/vt` | `vt.ts` | **foundation** | Real terminal stays authoritative (spec d) |
| Revision pairing | `pairing.ts` | **foundation** | Two-halves model maps onto FRAME_BEGIN/END (§4) |
| Evidence barrier (drain + quiet) | `pairing.ts`, `internal/quiet.ts` | **foundation** | Hard-won; see §2.3 |
| Locators, strict mode | `locator.ts`, `selectors.ts` | **rework** | Selector surface survives; `semanticTree: boolean` gating does not (spec c) |
| `TerminalModes` with `'unknown'` | `api.ts`, `vt.ts` | **foundation** | The "we cannot see it, so we do not claim it" pattern is exactly what per-property provenance needs |
| Diagnostics (18 codes) | `api.ts` | **rework** | Codes carry over; the set gains probe-attach/recognizer failures |
| `capabilities().semanticTree` | `api.ts` | **delete** | Binary flag is what progressive levels replace |
| Log ingestion (file tail + adapter records) | `logs.ts`, `session.ts` | **foundation** | Orthogonal to instrumentation |
| Crash report | `session.ts` | **foundation** | Orthogonal |

The most transferable thing the driver already owns is not code, it is a
**discipline about unverifiable claims**: `mouseTracking`, `mouseEncoding` and
`focusReporting` report `'unknown'` where the platform makes the truth
unobservable, and pointer actions refuse only on a mode *known* to be off
(`mouse.ts`, `api.ts`). That is the same shape as provenance ranking: a fact
with a weak source is not the same as an absent fact, and neither is the same
as a fact known to be false.

### 1.3 Adapters — what zero-config has to displace

At the start of the audit every adapter required source changes. The Ink and
OpenTUI rows below now show the zero-config replacement:

| Adapter | Mount-level change | Per-widget change | Tree source |
|---|---|---|---|
| Ink | none; launcher injects `@termwright/probe-ink` around ordinary `ink.render` | optional annotation-only `useSemantic` / `<Semantic>`; Ink `aria-*` remains framework-native | retained Ink host tree observed by the injected probe |
| OpenTUI | none; launcher injects `@termwright/probe-opentui` around ordinary renderer creation | optional annotation-only `describeRenderable` | retained Renderer scene graph observed by the injected probe |
| Textual (py) | `enable_semantics(app)` (`clients/python/.../textual_adapter.py:405`) | `termwright_role/name/test_id` attrs | Textual DOM via `screen.query("*")` |
| tview (go) | `Attach(app, root, …)` (`clients/go/termwright/attach.go:178`) | `WithDescriber` / `SetTestID` / `WithChildren` | tview primitive walk |

Three findings that matter for the campaign:

1. **The framework walk is framework-native and fact-like.** Probes derive
   physical facts from framework structures and shared recognizers now apply
   the ordered provenance merge. Developer intent and framework-native
   accessibility are separate Probe IR fields.
2. **The publication filter was where information was destroyed.** The
   zero-config Ink and OpenTUI probes now retain every observed host/Renderable,
   including unannotated layout objects as `generic` nodes. Regression tests
   assert that the vanilla fixtures keep the full subtree.
3. **Marker placement is already correct and already subtle.** Every adapter
   writes the marker *after* the frame bytes and *after* a drain: the Ink probe
   waits a macrotask because `onRender` fires before the write,
   OpenTUI collects synchronously inside the `frame` event because that event
   fires after the write, tview stashes the marker and writes it after
   `Screen.Show()` (`attach.go:294`). Any probe that replaces these adapters
   must reproduce this ordering per framework — it is not incidental.

Verdict: adapters are **delete** as a public API and **foundation** as a
reference corpus. Four independent implementations of "walk this framework's
tree and guess a role" are the best available specification of what recognizers
have to produce.

### 1.4 Transport today

- POSIX: `mkdtemp` directory in `tmpdir()` (mode 0700 by construction) holding
  `semantic.sock` (`semantic.ts:206`).
- Windows: `\\.\pipe\termwright-<16 random bytes hex>` (`semantic.ts:204`).
- Endpoint, token and protocol version reach the child as env vars
  (`ENV_ENDPOINT`, `ENV_TOKEN`, `ENV_PROTOCOL`); the endpoint is created
  **before** the child is spawned, so a program can hand over its first tree
  during startup.
- One adapter per session: a second connection is refused with a wire error
  rather than raced (`semantic.ts:238`).
- Refusals use `endAfterFlush` (`internal/socket.ts:25`) — `write(); destroy();`
  loses the frame, **measured** at 2 of 4 runs by the conformance suite before
  the fix.

---

## 2. The marker: correlation mechanism or metadata in escape sequences?

### 2.1 What the marker actually is

`\x1b]8487;twm;{revision};{mac}\x07` — one integer and a 22-character
authentication tag (`marker.ts:122`). It carries **no semantic content**: not a
role, not a name, not a bound. The revision is a pointer into data that
travelled on the socket, and the MAC exists only so ordinary program output
cannot forge one. The module states its own job in one line: *a frame COMMIT
signal (Neovim `flush` semantics), never a data carrier.*

Against the spec's "no metadata inside terminal escape sequences", the honest
reading is that this is **PTY output sequencing** and falls under §35's
allowance, not under the prohibition. If the prohibition is read literally
enough to cover a revision counter, it also forbids OSC 133 shell integration,
which the driver already depends on for `waitForQuiet`.

### 2.2 Can FRAME_BEGIN/END plus the drain/quiet barrier replace it?

No — and this is the one place in the audit where I would push back on a
plausible-sounding simplification.

The marker's unique property is that **it occupies a position in the byte
stream**. It answers: *the screen state after byte N corresponds to tree
revision R*. Nothing delivered on a side channel can answer that question,
because the socket and the pty are independent transports with independent,
unbounded, variable delay. A `FRAME_END` on the socket says the application
finished rendering. It does not say the driver's emulator has consumed the
bytes that rendering produced.

The drain/quiet barrier is not a replacement for that ordering; it is the
compensation we built *for its absence in the other direction*, and it is
strictly weaker. It can conclude "probably nothing more is in flight". It
cannot conclude "this byte position corresponds to this revision".

### 2.3 The evidence, because it was expensive

| Measurement | Result | Source |
|---|---|---|
| DCS through ConPTY | dropped | escape probe, run 31947757843 |
| APC, OSC 8 through ConPTY | dropped | same |
| Private OSC (BEL and ST), OSC 133 | pass | same |
| OSC 8487 specifically | pass, parsed, no leak | same (candidate added so the number itself was measured, not inferred from its family) |
| Parse-queue delay under a 200-render flood, macOS | transport +0 ms, parsing +692 ms against a 1000 ms window | flood probe |
| Transport delay when the pipe is slower than the socket | 1697 ms median, 3359 ms tail | throttled probe |
| Same, end to end | revision 1 of 200 with `revision-dropped×136, revision-expired×64` — identical to the Windows signature; fixed by the quiet condition, verified by disabling that one condition | conformance `-t "storm"` with `STDOUT_BPS=5000` |

Two conclusions Phase 1 should not re-litigate:

1. **In-band correlation is fragile but currently viable.** The marker rides
   OSC 8487 because DCS was measured dead on Windows. That was a forced move,
   not a preference, and the same forcing can happen again — a risk to carry,
   not a reason to abandon the mechanism.
2. **Byte-count correlation is not an alternative on Windows.** The obvious
   escape-free design — `FRAME_END` carries the number of stdout bytes the
   frame wrote, driver correlates by counting received bytes — dies on ConPTY,
   which re-encodes and repaints rather than forwarding. Counts on the two ends
   are not the same number. (macOS measured ratio 1.03; ConPTY is an emulator,
   not a pipe.)

### 2.4 Recommendation

Keep the marker as the correlation primitive; treat it as sequencing, not
metadata; keep it MAC-authenticated and content-free. If Phase 1 wants the
escape sequence gone, the burden is to produce an ordering primitive that
survives a terminal which rewrites the stream — and the probe results above are
the acceptance test it has to pass before anything is built on it.

---

## 3. Probe IR transport — constraints, not a design

### 3.1 Inherited FD / socketpair is not available through our spawn path

**Hard constraint, verified in the pinned dependency.** `@lydell/node-pty`
1.1.0 exposes `IBasePtyForkOptions` = `{name, cols, rows, cwd, env, encoding,
handleFlowControl, flowControlPause, flowControlResume}`, plus `uid`/`gid` on
POSIX and `conptyInheritCursor` on Windows (`node-pty.d.ts:20-94`). There is no
`stdio`, no fd array, no handle-inheritance option. A probe cannot be handed an
inherited socketpair FD unless we either wrap the child in a launcher process
that does the plumbing, or replace the PTY layer. Both are real options; both
are costs Phase 1 has to price, and neither is a small edit.

Consequence: **the path/name + env-var rendezvous survives by default**, not
because it is the best design but because the alternative requires touching the
spawn path that took three Windows CI iterations to stabilise.

### 3.2 What the current rendezvous costs and buys

Buys: works identically for Node, Python, Go and Rust clients with no extra
plumbing; endpoint exists before the child starts; naming is unguessable on
both platforms; a stale socket cannot be reused because the directory is
per-session and removed on close.

Costs: the endpoint is discoverable by anything running as the same user; the
token is the only thing preventing a same-user process from attaching. That is
acceptable for a test harness and should be stated as such rather than
implied.

### 3.3 Backpressure — what exists and what does not

- **Exists:** frame size ceiling enforced before the body is read
  (`framing.ts`), permanent decoder poisoning on violation, one-adapter-per-
  session, pairing eviction at `maxQueuedFrames` (32) with `revision-dropped`,
  half expiry behind the evidence barrier, adapter-side log token bucket, and
  the driver re-enforcing the same log budget on arrival.
- **Does not exist:** any read-side flow control on the semantic socket. The
  driver never pauses the socket; it relies on bounded frames plus eviction.
  Under a 200-revision burst the queue is trimmed by eviction, not by slowing
  the peer.

For the IR, the resync machinery is already there and already correct:
`get-tree` / `get-tree-result` with a request id (`messages.ts:90/97`), driven
by the driver when a delta cannot be applied, with the `delta-resync`
diagnostic. **`FULL_SNAPSHOT` on backpressure is not a new mechanism for us — it
is the existing resync path with a different trigger.** One caution from
history: when the resync returns a revision already published, republishing it
reads downstream as a *loss*; the driver fixed this by swapping the composed
head without republishing, and the regression is pinned by an assertion on the
**absence** of a misleading signal.

### 3.4 What carries over from revisions/deltas verbatim

- Strictly increasing revision numbers, gaps permitted.
- Delta base check is exact: `baseRevision !== base.revision` → refuse and
  resync, never rebase (`delta.ts:238`).
- Removal cascades to the subtree; upserts replace a node wholesale; order is
  removals then upserts.
- A delta may set but not clear the cursor.
- Composed trees are re-validated in full; a delta is never trusted to produce
  a valid tree, only to describe one. **This is the invariant to keep loudest**
  when facts arrive from several probes with different provenance.

---

## 4. Lifecycle mapping

| Spec lifecycle | Today | Notes |
|---|---|---|
| `HELLO` | `hello` (`messages.ts:33`): protocol id, token, adapter name/version, capabilities | Direct match. Capabilities become level/provenance claims |
| (ack) | `hello-ack` (`messages.ts:42`): sessionId, limits, `subscribe`, `marker.enabled`, optional `logs` budget | No spec counterpart named, but required: this is where the driver hands back limits and *chooses the mode*. Keep it |
| `FRAME_BEGIN` | **no equivalent** | Today the driver learns a frame started only by output arriving. A begin signal is new information: it separates "the app is rendering" from "the app is idle", which the quiet barrier currently has to infer |
| `FRAME_END` | `revision-commit` (`messages.ts:78`) + the marker | `revision-commit` is the socket-side half and is explicitly advisory: it says the adapter believes it committed N, and never publishes on its own |
| Tree payload | `snapshot` / `tree-delta` | Unchanged in role |
| Resync | `get-tree` / `get-tree-result` | Unchanged in role |
| Teardown | socket close → `adapter-disconnected`; protocol error → terminal `error` frame then close | Keep both; the terminal error frame is what makes a refusal debuggable |

The mapping is close enough that the lifecycle rename is mostly vocabulary,
with one genuine addition (`FRAME_BEGIN`) and one thing the spec's list does
not mention but the implementation cannot do without (the ack that carries
limits and the negotiated mode).

Worth noting explicitly: **`revision-commit` already proves the split the IR
needs.** The socket says what the application did; the marker says where that
landed in the byte stream; neither is trusted alone. A pairing that publishes
on `revision-commit` alone would report revisions that never reached the
screen.

---

## 5. Questions Phase 1 must answer (not answered here)

1. **Closed role vocabulary vs "unknown widget = generic node".** The 23-role
   set is enforced by schema; unknown roles are rejected outright
   (`roles.ts:5`). Progressive semantics needs an unrecognised widget to arrive
   as a `generic` node with whatever facts are known. Either the vocabulary
   opens (and every consumer's exhaustive switch becomes non-exhaustive), or
   `generic` plus a free-text hint carries the unknown case. This is a contract
   decision with consumers in trace, screenshot, ui, mcp and AccessKit export.
2. **Where provenance lives.** `SemanticNode` has no room for per-property
   metadata, and per-property provenance multiplies node size by a constant
   that has to be paid against `maxSnapshotBytes` (1 MiB default) and
   `maxNodes` (5 000).
3. **Retraction.** Deltas cannot unset a field. A recognizer that loses
   confidence needs to retract a fact, which is that gap made routine.
4. **Whether a probe can be injected at all without a launcher.** §3.1 — this
   gates the whole "no source changes" promise for every runtime, and the
   answer is likely different per language.
5. **What replaces the four publication filters.** Every adapter currently
   drops unrecognised nodes; making them `generic` instead changes tree size
   and every existing snapshot assertion in the conformance matrix.
