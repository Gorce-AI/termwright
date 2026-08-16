# termwright — normative cross-package contracts

Read together with `docs/superpowers/specs/2026-08-15-termwright-design.md`
(the design) and the origin spec it references. On conflict: this file wins for
interfaces, the design doc wins for scope, the origin spec wins for invariants.

## Source of truth per interface

| Contract | Normative location |
|---|---|
| Semantic wire protocol (messages, framing, marker, limits, roles) | `packages/protocol/src/*.ts` |
| Driver public API (`TerminalHarness`, `Locator`, errors, events) | `packages/driver/src/api.ts` |
| Trace archive format | this file, §Trace |
| UI ↔ runner event protocol | this file, §UI events |
| MCP tool surface | this file, §MCP |
| Semantic YAML snapshot format | this file, §YAML snapshots |

Changing a normative file requires: update it first, note the change in
`CHANGELOG-contracts.md`, then adapt consumers. Never fork a contract locally.

## Dependency rules (enforced by review)

- `protocol` depends on `zod` only. Never on React, Ink, MCP, PTY, driver.
- `driver` depends on `protocol` + PTY/VT libs. Never on Ink, Vitest, MCP.
- `ink`, `opentui` (adapters) depend on `protocol` + their framework. Never on driver.
- `test` depends on `driver` (+ `trace`, + `protocol` constants/types) and
  declares `vitest` as peer.
- `ink-testing` depends on `driver`, `ink` (adapter), `protocol`.
- `mcp` depends on `driver` + MCP SDK behind `src/sdk-facade.ts` (may also import constants/types from `protocol`). No session logic of its own.
- `trace` depends on `driver` types only (consumes `SessionEvents`) and may
  type-import from `protocol` (it stores `SemanticSnapshot` verbatim).
- `screenshot` depends on `driver` types only (consumes `CellSnapshot`) and may
  type-import from `protocol` (`CursorInfo`). Never on `trace` — the trace
  reader produces frames for it, not the other way round.
- `logs` depends on `protocol` only; logger libraries (pino, winston,
  consola, OpenTelemetry) are OPTIONAL peers, never runtime dependencies.
  Nothing depends on `logs` except adapters and the test layer.
- `ui` depends on `trace` + `driver`. Talks to Vitest only via our own event protocol.
- `conformance` may depend on everything; nothing depends on it.

## Engineering baseline (all packages)

ESM only, Node >= 22, TS strict per `tsconfig.base.json`, build with tsup,
tests with vitest (`*.test.ts` next to sources), no default exports, no `any`
in public surfaces. Every public function/type gets TSDoc. Errors thrown across
package boundaries must be `TermwrightError` subclasses. All I/O bounded per
`DEFAULT_LIMITS`/`ABSOLUTE_LIMITS`. Hostile-input suites must pass under
`node --max-old-space-size=128`.

## §Trace — `.twtrace` archive

A directory (zipped for transport) containing:

- `meta.json` — `{ v: 1, sessionId, command, columns, rows, startedAt,
  platform, semanticTree: boolean, exit?: {code, signal},
  crash?: {t, castOffset, exit, screenTail, lastSemanticRevision,
  recentInputs, diagnosticsTail} }`. `crash` mirrors the driver's
  `CrashReport` with two changes: it carries `castOffset`, and it stores the
  last semantic *revision* instead of the tree (the tree is already in
  `semantics.jsonl`). **`screenTail` is verbatim terminal output and is never
  redacted** — an archive carrying a crash must be treated like a screenshot;
  consumers that display it must repeat that warning.
- `session.cast` — asciicast **v3**; markers array entries map to test steps:
  label = step title. Recording includes all PTY output; `Hide()/Show()`
  windows excluded at write time.
- `events.jsonl` — one JSON object per line:
  `{ t: <ms>, castOffset: <ms>, kind: 'input'|'resize'|'step-start'|'step-end'|
     'action'|'assert'|'crash', ... }` where `action` carries
  `{ api, selector?, ref?, ok, error? }`. `castOffset` positions the event on
  the (idle-trimmed, hide-window-adjusted) recording timeline; readers fall
  back to `t` when absent.

`SessionEventMap` `timeMs` semantics (binding for the driver): milliseconds
since session start, monotonic, never resets for the lifetime of a session
(reconnects included).
- `semantics.jsonl` — `{ t: <ms>, revision, castOffset: <ms>, snapshot }`,
  snapshot = `SemanticSnapshot` verbatim.
- `logs.jsonl` — OPTIONAL, absent when the session logged nothing. One entry
  per line: `{ t: <ms>, castOffset: <ms>, source: 'file'|'adapter', label?,
  level?, message, attrs?, seq?, revision?, ts? }`. The driver's `app-log`
  carries either `line` (followed file) or `record` (adapter); both are stored
  as `message`, with `source` preserving the provenance. A file line has NO
  `level` — consumers must not infer one from its text. `meta.logs`
  summarises: `{ count, dropped, sources, levels }`, where `dropped` counts
  entries evicted by the writer's ceiling (oldest first) and is computed at
  finalize, never flushed on a following event. Redaction happens at the
  source (`@termwright/logs`); file lines are RAW and carry the same handling
  caveat as `crash.screenTail`.

Writer/reader live in `@termwright/trace`; UI and HTML report consume only via
those readers.

## §UI events — runner ↔ browser

WebSocket, JSON messages `{ v: 1, type, ... }`:
- server→client: `run-start`, `test-start {id, title, file}`,
  `step {testId, title, phase}`, `output {sessionId, dataB64, t}`,
  `semantic {sessionId, revision, snapshot}`,
  `app-log {sessionId, t, source, level, message, label?, logger?, seq?,
  revision?, attrs?}`, `test-end {id, status, traceRef}`,
  `run-end {summary}`.

`app-log` carries one application log entry: `source` is `'file'` (a followed
file line) or `'adapter'` (a record from an instrumented adapter), `t` is
session-clock milliseconds, `level` is a protocol `LogLevel` or **`null`** —
a file line has no level and none may be inferred from its text. `attrs` are
flat scalars. Receivers mark only `warn`/`error`/`fatal` on the timeline;
level-less entries produce no markers but are always listed.
- client→server: `rerun {testIds?}`, `stop`, `pick {sessionId}` (inspector
  pick-mode), `input {sessionId, dataB64}` (recorder mode only).
The Vitest bridge is a reporter translating Vitest lifecycle into these
messages; the browser app never imports Vitest.

## §MCP — tool surface (all tools validate with zod, return structuredContent)

`terminal.launch`, `terminal.capabilities`, `terminal.snapshot` (compact ref
format + visible text; `full` variant writes to disk and returns refs),
`terminal.capture_since {cursor}` (changed rows + changed semantic subtrees),
`terminal.query {selector|role/name}`, `terminal.click`, `terminal.double_click`,
`terminal.press`, `terminal.type`, `terminal.paste`, `terminal.write_raw`,
`terminal.drag`, `terminal.wheel`, `terminal.resize`, `terminal.signal`,
`terminal.scrollback`, `terminal.select_cells`, `terminal.copy_selection`,
`terminal.wait_for`, `terminal.close`.

Compact snapshot format (normative):

```
Terminal t1 100x30 revision 42
semanticTree: available
dialog "Permission" ref=n7@42 bounds=(8,20,40,9) modal
  button "Approve" ref=n8@42 bounds=(14,23,11,1) focused
visible text:
<grid text>
```

CLI: exit codes 0 ok / 1 assertion / 2 usage / 3 no-session / 4 ipc / 5 internal;
global `--json` (errors carry `kind`); `termwright agent-context` emits
versioned JSON generated from the zod schemas.

## §YAML snapshots — semantic snapshot format

```yaml
- dialog "Permission" [modal]:
    - text "Allow bash to run?"
    - button "Approve" [focused]
    - button /Rej.*/
```

Rules: node = `- role "name" [state,flags]` with children nested; name may be a
`/regex/`; omitted name matches any. TWO comparison modes, by source:
- **inline pattern** (argument to the matcher): partial — omitted children =
  don't-care, `[state]` flags assert only what they list;
- **stored file snapshot** (generated into `__snapshots__`): STRICT — full
  tree, exact flags; any difference (including a NEW node or state) fails,
  and update mode `changed` rewrites on any textual difference.
Serializer+matcher live in `@termwright/test`; format shared with docs and UI
inspector copy-paste.

## Git hygiene in this shared tree (binding for every agent)

The git index is shared between concurrently working agents. Therefore:
1. Commit ONLY with explicit paths: `git commit --only <your-paths> -m ...`
   (never bare `git commit`, never `-a`, never `git add -A` without paths).
2. Never `git stash`, `git checkout`, `git reset` on the whole tree — your
   own paths only. To test "is my new test red without my fix", copy the
   file aside, don't rewind the tree.
3. Never `--amend` and never rewrite history: check `git log -1` before you
   commit; if HEAD is not yours, that's fine — just commit your paths.
   Practice notes: `--only` SKIPS untracked files — `git add <new files>`
   first, then `git commit --only <paths>`. And `git checkout <ref> -- <paths>`
   writes to the shared INDEX, not just the working tree — check the first
   column of `git status --short` before committing.
4. Root files (pnpm-lock.yaml, CONTRACTS.md, workspace config) are committed
   by the coordinator only; report needed changes instead of committing them.

## Definition of done (every package)

1. `pnpm build && pnpm typecheck && pnpm test` green in the package.
2. Public surface documented (TSDoc) and exported through `src/index.ts` only.
3. Unit tests cover the package's contract obligations, including error paths.
4. No TODO/stub left in exported code paths; internal TODOs tracked in the
   package's `NOTES.md` if any.
5. README.md in the package: purpose, install, 30-line usage example.
