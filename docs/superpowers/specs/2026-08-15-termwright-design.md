# termwright — design

Date: 2026-08-15 (as-built addendum: 2026-08-16)
Status: IMPLEMENTED — 1.0 scope delivered; this document is the design of
record, `CONTRACTS.md` + `CHANGELOG-contracts.md` record every contract
decision made during implementation (tree deltas, app logs, crash reports,
terminal profiles, ARIA/AccessKit a11y, TTL, tolerant-reader evolution rules).
Windows/ConPTY and the release pipelines are code-complete but first verified
by the initial GitHub Actions runs.
Repo: github.com/gorce-ai/termwright (npm scope `@termwright`, brand: **termwright**)
Origin spec: `gorce-eco/docs/TUI-SEMANTICS-DRIVER-SPEC.md` (this design supersedes its
working names and refines its protocol; all its invariants remain binding unless
explicitly amended below).

## 1. Vision

Playwright for the terminal. A real PTY plus a standards-grade VT emulator gives
exact observation of any terminal app; an application-published **semantic tree**
(the terminal analogue of an accessibility tree) gives Playwright-grade locators
(`getByRole('button', { name: 'Approve' })`) instead of brittle text scraping.
One driver serves three consumers: deterministic tests (Vitest preset), AI agents
(MCP), and an interactive runner UI with live preview and time travel.

Market position (research, Aug 2026): no one has an app-published semantic tree
for TUIs. microsoft/tui-test (Rust, agent-first, ~82k npm dl/mo) is grid-only;
Textual Pilot / teatest are single-framework and in-process; the everyday
competitor is "tmux + capture-pane + agent". Ink is the wedge: 20.9M dl/mo,
its only test harness (`ink-testing-library`, 2.1M dl/mo) is abandoned and broken
on current Ink. Messaging leads with Ink; architecture is cross-framework.

Three headline differentiators (nobody has any of them):
1. **Semantic YAML snapshots** (aria-snapshot style) — snapshots that break only
   when meaning changes, not when whitespace does.
2. **Failure forensics**: HTML report with visual + semantic diff, plus an
   always-on asciicast recording with `test.step()` markers.
3. **Incremental semantic diff for agents** (`capture_since` applied to the tree,
   not just rows) — agents stop burning context on unchanged screens.

## 2. Decisions log

| Decision | Choice |
|---|---|
| Brand / npm scope | `termwright` / `@termwright` (npm+PyPI free; dead `fcoury/termwright` and taken crate name accepted — crate ships as `termwright-protocol`) |
| GitHub org | `gorce-ai` |
| 1.0 scope | Everything: protocol, driver, adapters, component testing, MCP, conformance, trace, Vitest preset, interactive runner UI with time travel |
| Windows | Full ConPTY support in 1.0, own conformance lane + Windows CI |
| Runner | Vitest as the first-class preset; driver stays runner-agnostic (works from node:test/Jest/scripts) |
| Core language | TypeScript core; protocol is language-neutral with thin clients for TS, Python, Go, Rust |
| 1.0 adapters | Ink (full, first), OpenTUI, Textual, tview; Bubble Tea honest degradation (+ Lip Gloss Canvas adapter); Ratatui instrumented adapter in 1.x |
| PTY | `@lydell/node-pty` pinned exact `1.1.0`, behind a `PtyBackend` interface (upstream node-pty stable lacks Linux prebuilds; fork has all 6 platforms as optionalDependencies) |
| VT | `@xterm/headless` 6.0 + `@xterm/addon-unicode11` (explicitly activated) + `@xterm/addon-serialize` |
| Render marker encoding | Private **DCS** (or private OSC fallback) — verified registrable and grid-invisible in xterm headless; **not APC** (unsupported by xterm.js) |
| Semantic transport | Out-of-band local channel (unix socket / named pipe), CDP-style request-response + subscriptions; in-band marker is a frame **commit** (Neovim `flush` semantics), never a data carrier |
| MCP SDK | v1.30.x behind our own facade (v1→v2 package-rename split in progress); Zod v4 from day one |
| No musl/Alpine in 1.0 | documented (`node:22-slim`), no PTY candidate ships musl prebuilds |

## 3. Package map

```
npm (TypeScript, pnpm monorepo, changesets):
@termwright/protocol      schemas (JSON Schema + zod), limits, roles, framing,
                          handshake, versioning; zero deps on React/Ink/MCP/PTY
@termwright/driver        PTY+VT adapters, sessions, screen model, locators,
                          actions, waits, typed errors, recording hooks
@termwright/test          Vitest preset: fixtures (test.extend), matchers,
                          semantic YAML snapshots, cell snapshots, trace reporter,
                          retries/flaky classification, termwright.config.ts
@termwright/ink           production adapter for Ink 7 (aria-props + useSemantic)
@termwright/ink-testing   mountInk (in-process) + launchInkFixture (real PTY)
@termwright/opentui       adapter for OpenTUI (screenX/screenY, lifecycle hooks)
@termwright/mcp           thin MCP server over the public driver API
@termwright/trace         trace format: asciicast + events.jsonl + semantics.jsonl,
                          readers/writers, HTML report generator
@termwright/ui            interactive runner: local server + browser app
                          (xterm.js live view, semantic inspector, timeline,
                          time travel, recorder/codegen)
@termwright/conformance   generic/semantic/adversarial/component fixtures and
                          reusable adapter contract tests
termwright                umbrella package + CLI (`termwright ui`, `agent-context`,
                          `usage`) re-exporting the common surface

same monorepo, other registries:
termwright-py             PyPI: protocol client + Textual adapter
termwright-go             Go module: protocol client + tview adapter
termwright-protocol (rs)  crate: protocol client (+ experimental Ratatui adapter 1.x)
```

Dependency rules (from origin spec §5, unchanged): `protocol` depends on nothing
framework-specific; `driver` never depends on Ink; `mcp` consumes only the public
driver; adapters depend on protocol + their framework, never on the driver.

## 4. Semantic protocol v1

### 4.1 Transport and lifecycle

- Driver creates a private endpoint before spawn: unix socket in a 0700 tmpdir
  (macOS/Linux) or named pipe with unguessable name (Windows). Never TCP.
- Env injected into the child: `TERMWRIGHT_ENDPOINT`, `TERMWRIGHT_TOKEN`
  (256-bit random), `TERMWRIGHT_PROTOCOL=1`.
- **Dormant rule**: without these env vars an adapter opens nothing, allocates
  nothing, emits nothing; output is byte-for-byte identical to an uninstrumented
  run. Conformance enforces this.
- Handshake: bounded `hello` with token, protocol version, adapter id, and a
  capability list (nvim `ui_attach` pattern). Driver replies with selected
  version, session limits, and marker configuration. No valid hello within the
  negotiation window (default 250 ms) ⇒ `semanticTree: false`, session continues
  generically; late/malformed hello never flips an already selected mode.
- Framing: length-prefixed JSON with a pre-decode byte ceiling; fail closed on
  partial/duplicate/oversized frames. All parsed data projected into immutable
  plain DTOs (no accessors, proxies, prototypes).

### 4.2 Message model (CDP-like)

Three traffic kinds on one channel:
1. adapter push: `revision-commit { revision }` after each committed render;
   optionally changed subtrees when the diff capability is negotiated;
2. driver request/response: `getTree { revision? }`, `getNode { id }`;
3. subscriptions: driver declares whether it wants full snapshots, diffs, or
   bare revision numbers.

v1 ships full snapshots after each commit (origin spec §8.3); the
request/response frame is in the protocol from day one so 1.x diffs are additive,
not breaking. Every delta (when introduced) binds an exact base revision; any gap
forces a full rehydrate.

### 4.3 Frame↔tree pairing (render marker)

- The stdout marker is a **frame commit**, not a data channel: emitted by the
  adapter after the last byte of the render for revision N; payload is
  `N` + HMAC(token, N) so ordinary output cannot forge it.
- Encoding: private DCS sequence (registered handler in the VT layer removes it
  from the visible grid). Emitted only after a successful handshake; never in a
  normal run.
- Driver publishes revision N only when it holds both the tree N and the grid
  state at marker N. Bounded waits both directions; superseded incomplete
  revisions dropped with a diagnostic; process exit publishes the last fully
  paired revision (origin spec §9 unchanged).

### 4.4 Data model

- Snapshot/node/rect shapes, role list, closed state set, action capability list:
  as origin spec §8.1, with three amendments:
  - `bounds` is **optional** from day one (class-B/C frameworks produce role+name
    nodes without trustworthy coordinates);
  - snapshot carries a `cursor` field (position/visibility/shape) — Bubble Tea v2,
    Textual and Ratatui all surface cursor state worth asserting;
  - roles stay ARIA-aligned to keep a future AccessKit/AT-SPI bridge possible.
- Role resolution is a three-level fallback, normative for all adapters:
  (1) explicit author annotation → (2) framework widget-type map → (3) `generic`.
- Tree invariants and absolute ceilings: origin spec §8.2 verbatim (unique ids,
  acyclic, depth/count/byte bounds, strictly increasing revisions, hostile-input
  rejection without execution).

## 5. Driver

### 5.1 Session core

`launchTerminal({ command, cwd, env, columns, rows, semanticNegotiationMs,
scrollbackLines, shell?, recording? })` → PTY via `PtyBackend` interface
(`spawn/write/resize/onData/onExit/signal`), fed into `@xterm/headless`.
Verified constraints honored in code:
- every emulator `write` wrapped in a promise on its callback (async buffer);
- Unicode 11 addon activated explicitly (`unicode.activeVersion = '11'`);
- CJS-only import workaround for the headless package in our ESM build;
- own CSI `?h/?l` handler tracks mouse-encoding modes that `terminal.modes`
  does not report.

Screen snapshot: immutable, revision-stamped; cells (grapheme, width, fg/bg,
attributes), cursor, active buffer (normal/alternate), input-relevant modes,
bounded scrollback with explicit retained floor, grapheme↔cell offset mapping.

Process control in 1.0: `signal('INT'|'TERM'|'KILL')`, raw `write(bytes)`
(no newline), title assertions (OSC 0/2), exit status/signal observable
separately from close. Close is idempotent; destructive signals are explicit.

### 5.2 Locators

Two dialects over one engine, evaluated driver-side on the latest accepted tree:
- Playwright family: `getByRole(role, {name, exact, state})`, `getByLabel`,
  `getByText(textOrRegex, {occurrence})`, `getByTestId` (configurable attribute),
  `locator(sel).within(parent)`;
- Textual-style CSS dialect: `locator('dialog button.primary:focused')` with
  `#id`, `.class`, `:focused/:disabled/:selected/:checked` pseudo-classes.

Strict by default: zero matches wait until deadline; >1 match fails with bounded
candidate diagnostics. Locators are lazy handles (re-resolved per action);
snapshot refs `n8@42` bind their revision and raise a typed stale error.

Generic fallbacks (no semantics): literal/regex over grid text, occurrence
selection, line/rect/coordinate targets, style predicates (fg/bg/attribute
match — "expect text ERROR with fg red"), region scoping, scrollback search.
Generic matches yield rectangles, never invented roles; diagnostics always say
`semanticTree: false`.

### 5.3 Actions and waits

All input goes through the PTY (never a callback): click/dblclick/drag/wheel via
negotiated mouse encoding (SGR etc.) with pre-flight checks (visible, enabled,
in-viewport, mouse mode on — else typed `unsupported`); keyboard honoring
application cursor/keypad modes; `paste` bracketed only when the child enabled
it; `resize` waits for PTY resize + a subsequent stable render. Optional
`activate()` reports which physical strategy it used.

Waits are revision/event-based, never sleeps: `waitFor({state})`, `waitForText`,
`waitForRender({after})`, `waitForStable({frames, timeout})` ("no screen or
semantic revision for a quiet interval, no unpaired render in flight"),
`waitForIdle` and `waitForReady` (shell prompt) for generic sessions. Timeout
classes: separate defaults for text/idle/ready/exit/action, each overridable
per call, config, and env.

Scroll/selection stay four distinct APIs (origin spec §14): app scroll (input),
emulator scrollback (no input), app selection (real drag), emulator cell
selection/copy.

Typed errors (timeout, stale-snapshot, ambiguous, unsupported-action,
history-truncation, protocol-violation, capacity, process-exit, closed) render
Playwright-grade messages: what was awaited, last observed screen excerpt +
semantic candidates, and a suggestion.

## 6. Test layer

### 6.1 `@termwright/test` (Vitest preset)

- Fixtures via `test.extend`: `terminal` (launch/teardown, trace on failure),
  per-test isolation (own PTY, tmpdir, env). `test.step()` names steps for
  report and recording markers.
- Matchers via `expect.extend` (Vitest 3.2 typing): `toBeVisible`, `toBeFocused`,
  `toHaveState`, `toHaveText`, `toMatchCellSnapshot`,
  `toMatchSemanticSnapshot` — locator matchers self-poll to timeout;
  `expect.poll`/soft assertions available for the rest.
- **Semantic YAML snapshots** (headline feature): the semantic tree serialized as
  readable YAML (`- button "Approve" [focused]`), supporting partial matching and
  regex (`- heading /Issues \d+/`), stored in external `-snapshots` files for
  reviewable diffs. Cell snapshots and semantic snapshots remain separate oracles
  (a semantic-only test could pass on a blank screen); important E2E asserts both.
- Snapshot updating: `--update-snapshots` with `all|changed|missing` modes.
- Retries with **flaky classification** (reported separately from failed);
  `--last-failed`, `--repeat-each` and CI sharding ride on Vitest equivalents —
  documented as supported in 1.0.
- Config profiles (`profiles: { ci: {...} }`) with a deterministic color
  palette per profile, so color assertions are stable across environments.
- Config `termwright.config.ts`: dimensions, timeout classes, trace mode
  (`on|retain-on-failure|off`), recording (default: always on), snapshot dirs,
  deterministic color palette profile for CI.
- Driver remains fully usable from node:test/Jest — documented; the preset is a
  thin adaptation layer (~5% of code), swappable without touching driver or
  protocol.

### 6.2 Component testing (`@termwright/ink-testing`)

Two modes, one `TerminalHarness` interface (same locators/actions/matchers as
`launchTerminal`):
- `mountInk(<Comp/>, { columns, rows, wrapper })`: in-process; fake stdout feeds
  the same headless VT; the same Ink adapter publishes semantics; a click becomes
  a real mouse byte sequence into the component's stdin — never a semantic-channel
  callback. React settlement (`act`, flush, `maxFps`/`debug` determinism) hidden
  behind revision waits. Asserting a prop spy after physical input is normal.
- `launchInkFixture({ component, props })`: real-PTY subprocess for raw-mode
  stdin/modes/resize fidelity; props cross via bounded JSON, never eval.
Test pyramid and mode-selection guidance: origin spec §10.3 verbatim.

## 7. Adapters

Feasibility classes (research): **A** retained tree with bounds (Ink, OpenTUI,
Textual, tview, prompt_toolkit, libvaxis, Notcurses), **B** string composition
(Bubble Tea + Lip Gloss joins — no per-widget positions exist), **C** immediate
mode (Ratatui, cursive, urwid — positions exist only during the draw call).
Product consequence: one protocol, two conformance levels — `full-semantic`
(A) and `instrumented` (C, one-line wrapper by the app author); B degrades to
generic text mode unless using Lip Gloss v2 Canvas/Layer.

- **Ink (1.0, first)** — reads Ink 7's existing `aria-role`/`aria-state`/
  `aria-label` props plus our `useSemantic(ref, {...})` hook; bounds from public
  `measureElement` (absolute x/y verified in Ink 7 source); publication on
  `onRender` + `waitUntilRenderFlush()`; marker via `useStdout().write()`
  (never through Ink's canvas — it tokenizes/clips non-SGR sequences; PoC in the
  first vertical slice). Absolute row/col guaranteed only under
  `alternateScreen: true` or an explicitly derived frame offset; the adapter
  reports the `absolute-bounds` capability only when it can honor it. Upstream
  PR to Ink is the strategic goal (they already invested in a11y); we do not
  block on it.
- **OpenTUI (1.0)** — `Renderable` exposes cached `screenX/screenY`, parent
  chain, `getChildren()`, lifecycle hooks and `layout-changed`; we add a role
  convention via reconciler props. The Zig core's C ABI is the long-term lever.
- **Textual (1.0, `termwright-py`)** — `query("*")` + `widget.region` (absolute),
  role map from widget class with author override; positioned to **coexist with
  Pilot** (we add real-PTY, cross-framework, revision-based waiting), not replace it.
- **tview (1.0, `termwright-go`)** — `GetRect()` + `SetAfterDrawFunc` commit
  hook; child enumeration by type-switching known containers + optional root
  registration; roles from Go type map.
- **Bubble Tea (1.0, honest)** — documented text-mode degradation; semantic
  support only for Lip Gloss v2 Canvas/Layer apps or explicit annotations. No
  fork, no pretending.
- **Ratatui (1.x)** — `render_widget_named` frame decorator (the `data-testid`
  cultural compromise); talk to `ratatui-layout` authors early.
- **pexpect/expect compat shim (1.x)** — thin `send`/`expect(pattern)` layer over
  the driver as a migration path for thirty years of expect-script muscle memory.
- Explicitly not doing: blessed (dead), termui (stagnant), full 8-shell matrix,
  Sixel/graphics protocols.

## 8. Trace, recording, reports, runner UI

### 8.1 Trace (`@termwright/trace`)

Archive (`.twtrace` dir/zip): `session.cast` (asciicast v3; **markers from
`test.step()` in 1.0** — a navigable recording that jumps to the failing step is
headline feature #2), `events.jsonl` (inputs, test steps, locator actions +
diagnostics, timestamps), `semantics.jsonl` (tree snapshot per revision with
revision↔cast-offset mapping). **Recording is on by default** (tui-test's
correct default); trace collection `retain-on-failure` by default.
`Hide()/Show()` API to exclude setup from recordings and `idle_time_limit`-style
trimming on export — both cheap, both 1.0.

### 8.2 Failure reports (1.0)

HTML report per run: side-by-side visual diff of cell snapshots (rendered via
`serializeAsHTML`), **semantic diff** ("button 'Submit' state changed to
disabled"), failing step highlighted, embedded recording player. Failure
messages in the terminal link to it. This is the single biggest
differentiation opportunity (competition is weakest here).

### 8.3 Runner UI (`@termwright/ui`, 1.0)

`termwright ui`: local server + browser app hooked into Vitest watch via
reporter/API (our own small event protocol, no Vitest internals). Three panes:
1. live terminal (xterm.js — same engine as headless, pixel-identical);
2. semantic inspector (hover highlights bounds, click generates a selector —
   DevTools "pick element" for the terminal);
3. test/step timeline with **time travel**: scrub → replay cast to offset +
   nearest semantic snapshot ≤ that revision.
Modes: live (WebSocket from driver during watch) and post-mortem (open a
`.twtrace` from CI). **Recorder/codegen in 1.0**: interact with the live
terminal in the UI *or* run `termwright codegen -- <command>` in a terminal;
both generate test code with semantic locators (the killer adoption feature —
easier in a terminal than in a browser since we own the full input stream).

Screenshots: HTML serialization in core; **SVG screenshots with embedded Nerd
Font glyph paths** (tui-test's trick — self-contained, never misrenders icons)
as an optional package in 1.0; no Chromium in core deps.

## 9. MCP (`@termwright/mcp`)

Thin multi-session owner over the public driver — tool handlers validate (Zod
v4), call, project; identical locator/wait semantics as the library. SDK v1.30
behind an internal facade (v2 package-split migration planned); session state
keyed by MCP session id in our layer, not in transport objects. Transports:
stdio + Streamable HTTP.

Tools: origin spec §17 list, plus:
- `terminal.snapshot` returns the compact ref format
  (`button "Approve" ref=n8@42 bounds=(14,23,11,1) focused`) with visible text;
  full dumps can be written to disk with only refs returned (playwright-cli
  pattern);
- `terminal.capture_since { cursor }` — incremental: changed rows AND changed
  semantic subtrees since the given revision (headline agent feature);
- one typed `snapshot_pane`-style value: content + cursor + modes + scroll
  offset in one call;
- `structuredContent` + `outputSchema` on every tool; `ImageContent` for
  optional screenshots (results only).

Agent ergonomics (1.0): exit-code taxonomy for the CLI (0 ok / 1 assertion /
2 usage / 3 no-session / 4 ipc / 5 internal), global `--json` with `kind` on
errors, `termwright agent-context` (versioned JSON describing every command,
flag, enum, default, and the exit-code taxonomy — generated from code),
`termwright usage` one-screen cheat sheet, and `termwright skill` emitting an
agent-skill package (distribution channel into Claude Code and friends) — all
1.0. Secrets: token never echoed; child env inheritance explicit and
secret-safe.

For non-cooperating apps: `semanticTree: unavailable`, text/cell refs, no
invented roles.

## 10. Security and resource bounds

Origin spec §18 adopted verbatim (unpredictable per-launch endpoints/tokens,
user-only permissions, pre-decode byte caps, absolute ceilings on
depth/count/bytes/frames/waiters/sessions, flood eviction with retained floor,
typed outcomes for disconnect/crash/partial/duplicate/mismatch, exactly-once
waiter settlement, dormant-without-endpoint, token redaction). Hostile suites
run under `--max-old-space-size=128`.

## 11. Conformance, CI, platforms

- Fixtures: generic (uninstrumented), semantic (Ink matrix: nested regions,
  duplicate names, modal, list, scrollable, disabled/selected/focused,
  wide/combining text, alt-screen), adversarial (invalid token/version,
  oversized/partial/duplicate frames, cycles, missing parents, impossible
  bounds, decreasing revisions, marker-without-tree and inverse, rerender
  storms, floods, disconnects, hostile Unicode), component harness (§20.2a),
  interaction scenarios (§20.4) — all as origin spec §20.
- Adapter contract tests are runnable against any adapter (including Py/Go/Rust
  via subprocess fixtures) so third-party adapters can self-certify.
- CI matrix: macOS, Linux (glibc), **Windows/ConPTY first-class**; Node 22/24;
  prebuild install tests per platform; 128 MiB adversarial gate; Alpine/musl
  documented as unsupported (use `node:22-slim`).

## 12. Repo, publishing, docs

- pnpm monorepo + changesets; npm publish with provenance; `termwright-py` to
  PyPI, Go module tagged in-repo, crate `termwright-protocol` to crates.io —
  each versioned independently, bound to the **protocol** version.
- Docs site (Starlight): per-framework quickstarts (Ink first), API reference
  from types, guides (why-not-tmux, migration from ink-testing-library /
  teatest / Pilot / pexpect), protocol spec for adapter authors, ADRs
  (PTY, VT, transport, MCP — drafted from this research) committed from day one.
- Public artifacts in English; `termwright` umbrella README is the pitch.

## 13. Risks

1. **Ink marker path unproven** — `useStdout().write()` interleaving with Ink's
   frame writes must be PoC'd in the first vertical slice (highest technical risk).
2. **Absolute bounds outside alt-screen** — frame-offset derivation is fiddly;
   mitigated by capability flag + documented `alternateScreen` recommendation.
3. **Windows/ConPTY in 1.0** — known divergent resize/mouse behavior; own
   conformance lane budgeted; honest capability output where behavior differs.
4. **`@lydell/node-pty` bus factor 1, `latest` tag on beta** — exact pin,
   install tests in CI, `PtyBackend` abstraction as insurance; migrate to
   upstream 1.2.0 stable when released.
5. **MCP SDK v1→v2 split** — facade isolation; Zod v4 from day one.
6. **Scope weight of full-1.0** (UI + Windows + 4 adapters + 3 language clients)
   — mitigated by strict package boundaries and the milestone order below;
   the umbrella 1.0 ships only when all lanes pass conformance.
7. **Chicken-and-egg for semantics** — the generic PTY+VT mode must be excellent
   standalone; semantics is an upgrade, not a requirement.

## 14. Milestones (each ends with an independent finding-only review)

1. **Protocol + ADRs** — schemas, limits, DTO validation, handshake, framing;
   marker PoC through xterm headless (DCS handler) and through a real Ink app.
2. **Generic driver** — PTY lifecycle, VT grid, keyboard/paste/resize/mouse,
   text/cell locators, waits, typed errors; macOS/Linux/Windows green.
3. **Semantic v1 + Ink adapter** — registration, measurement, full snapshots,
   revision pairing, rich locators, semantic YAML snapshots, `mountInk`.
4. **Interaction completeness** — scrolling, both selection models, Unicode
   torture matrix, cell snapshots, recording always-on.
5. **Test layer + reports** — Vitest preset, matchers, retries/flaky, HTML
   report with visual+semantic diff, trace format finalized.
6. **MCP + agent surface** — tools, refs, capture_since, agent-context, --json,
   exit-code taxonomy, multi-session lifecycle.
7. **Runner UI** — live view, inspector, timeline/time-travel, recorder +
   codegen CLI, SVG screenshots.
8. **Adapters wave** — OpenTUI, Textual (`termwright-py`), tview
   (`termwright-go`), Bubble Tea degradation docs, protocol clients.
9. **Hardening + publish** — 128 MiB gates, platform matrix, conformance
   package, docs site, semver policy, coordinated 1.0 publish (npm/PyPI/Go/crates).

## 15. Explicit non-goals (beyond origin spec §3)

Full shell matrix beyond bash/zsh/pwsh; Sixel/kitty-graphics assertions;
VHS `.tape` DSL (revisit 2.0); `--only-changed`; own test scheduler; pixel-exact
native terminal chrome; screen-reader accessibility claims in v1 (the ARIA-aligned
role model deliberately keeps that bridge open).
