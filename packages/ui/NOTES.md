# @termwright/ui — implementation notes

Decisions that are not obvious from the code, and the open threads other package
owners need to know about.

## The socket carries events; HTTP carries state

`/CONTRACTS.md` §UI events is a closed list of seven server messages and four
client messages, and this package implements exactly that list — no extra
message types, no "while we're here" additions.

Time travel and the recorder need more than events, though: the state at a
millisecond, the session list, the generated source. All of it lives under
`/api/` as plain HTTP:

| Route | Purpose |
|---|---|
| `GET /api/state` | mode, attached sessions, opened trace, recorder status |
| `GET /api/trace/state?t=` | `openTrace().stateAt(t)`, base64-encoded |
| `GET /api/record/events` | recorded events + current generated source |
| `POST /api/record/action` | record a click / visibility assertion on a node |
| `POST /api/record/assert` | `toMatchSemanticSnapshot()`, `toHaveText`, `waitForText` |
| `POST /api/record/step` | open a `test.step()` grouping |
| `POST /api/record/save` | write the generated test to disk |

Reads are pulls rather than pushes on purpose: a scrub fires on every pixel of
slider movement, and streaming the whole recording into the browser so it can
seek locally would mean shipping the archive twice and reimplementing `stateAt`
in the page.

**If the UI protocol ever needs to grow** (a `seek` message for a shared
scrubbing session, say), it grows in CONTRACTS.md first, and these routes are
where the shape has already been proven.

## What the browser app is, and why it is not React

Vanilla TypeScript with lit-html for the two rendered panes; xterm.js keeps its
own DOM because it owns a canvas-ish render loop. lit-html is ~3 kB gzipped and
is a template function, not a framework: no build-time transform, no component
model to learn, no reconciler between us and a pane that redraws on every
`output` message. The whole bundle is ~82 kB gzipped, most of it xterm.

State lives in one object in `app/main.ts` and every message schedules one
`requestAnimationFrame` render, so the panes cannot disagree about the run.

## Cell metrics without reaching into xterm

Overlay boxes need the pixel size of a cell. xterm exposes it only through
`_core._renderService.dimensions`, which is private and has changed shape across
versions. `app/terminal-pane.ts` measures the rendered `.xterm-screen` element
instead: `clientWidth / cols` is exact for a monospaced grid and survives
renderer and version changes.

## Steps on the timeline come from the trace, not from Vitest

Vitest's reporter API reports *tests*; `test.step()` boundaries exist inside the
worker and never reach a reporter. So the bridge emits `step` messages when a
test finishes, by reading the steps out of the `.twtrace` the fixtures wrote
(`task.meta.termwright.traces`). Steps therefore arrive as a batch at the end of
each test rather than as it runs.

The same reason explains why `output` and `semantic` are missing from
out-of-process live runs: a worker cannot reach the server's hub, and pushing
every PTY byte through the reporter's IPC channel would slow down the run the UI
exists to observe. In-process runs (a future `termwright ui` driving Vitest
through its Node API) call `attachSession(hub, harness)` and get the full stream;
out-of-process runs get the timeline, and the trace is one click away.

**If Vitest grows a step-reporting hook**, `#publishSteps` in `reporter.ts` is
the one place that changes.

## No dependency on `@termwright/test`

The task sketch allowed extending that package's reporter. It would have meant a
runtime dependency the contract's dependency rules do not grant `ui` (`ui`
depends on `trace` + `driver`), so this reporter is standalone and reads the
reported task objects structurally — the same `task.meta.termwright.traces`
shape, no import. The two reporters are independent and compose: run both.

`protocol` is a **type-only** dev dependency (`SemanticSnapshot` passes through
this package verbatim), mirroring the relaxation `trace` already has; noted in
`CHANGELOG-contracts.md`.

## Recorder: bytes in, actions out

The browser sends raw bytes (`input`), because that is what a terminal produces.
`input-decode.ts` is the inverse of the driver's `encodeKeys`: it turns them back
into `press('ArrowDown')`, `type('ls -la')` and `paste(...)`. It is round-trip
tested against `encodeKeys` itself, so the two stay in step.

Three deliberate limits:

- unrecognised sequences (mouse reports, exotic CSI) become `raw` and are
  generated as `write(Buffer.from(…, 'base64'))` — never dropped, never guessed;
- the pending buffer is capped at 64 KiB, so a sequence that never terminates
  cannot grow without bound;
- decoding assumes `applicationCursorKeys: false` for `SS3`-vs-`CSI` cursor keys.
  Both forms decode to the same key name, which is what codegen needs, so the
  ambiguity is harmless here.

Pick mode suppresses input forwarding: pointing at the screen to identify a node
is a UI gesture, and neither the child nor the recording should see it.

## `toMatchSemanticSnapshot()` without an argument

"Assert here" generates the matcher with no inline expectation. The preset writes
the YAML snapshot file on the first run, which is the artefact a reviewer reads —
and it keeps this package from having to implement the YAML serializer that
`@termwright/test` already owns.

## Security posture

Loopback bind, 24 random bytes of token per launch, constant-time comparison,
token accepted from the query string, an `x-termwright-token` header, or the
`SameSite=Strict; HttpOnly` cookie the app page is given (a page cannot put the
query token on its own `<script src>`). Bounds: 8 MiB WebSocket frames, 1 MiB
request bodies, a 4 MiB / 4096-message replay backlog that drops output before
lifecycle messages, and the decoder cap above. `src/hostile.test.ts` runs under
`node --max-old-space-size=128`.

Record mode runs a program the user named, in the user's shell environment. That
is the point of the feature, and it is the reason the token is not optional.

## Verified in a real browser

The three panes, selector generation, pick-mode hit testing and time travel were
exercised through Playwright against a running server on a fixture archive:
scrubbing to the second marker replayed the recording into a fresh terminal and
switched the inspector to the matching revision, and pick mode produced an
overlay box positioned from cell metrics. There is no automated browser suite in
this package yet — a Playwright project would be the next step, and belongs with
the CI lane rather than in `vitest run`.

## Open threads

- **`termwright ui` binary** (task #10, the umbrella CLI) wires the flags:
  `--trace <file>`, `--record -- <command>`, `--port`, and spawning Vitest in
  watch mode with `TERMWRIGHT_UI_URL` set. `startUiServer` is the whole surface it
  needs; `onRerun` / `onStop` are the hooks for the watch controls.
- **Multiple sessions in one test** are attached and listed, but the terminal
  pane shows the first one that produced output. A session switcher is a small
  addition to `app/main.ts` when a test that runs two programs at once shows up.
- **SVG screenshots** (design §8.3) are not here; they were scoped as a separate
  optional package.
