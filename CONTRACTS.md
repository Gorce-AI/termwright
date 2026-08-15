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
- `test` depends on `driver` (+ `trace`) and declares `vitest` as peer.
- `ink-testing` depends on `driver`, `ink` (adapter), `protocol`.
- `mcp` depends on `driver` + MCP SDK behind `src/sdk-facade.ts` (may also import constants/types from `protocol`). No session logic of its own.
- `trace` depends on `driver` types only (consumes `SessionEvents`) and may
  type-import from `protocol` (it stores `SemanticSnapshot` verbatim).
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
  platform, semanticTree: boolean, exit?: {code, signal} }`
- `session.cast` — asciicast **v3**; markers array entries map to test steps:
  label = step title. Recording includes all PTY output; `Hide()/Show()`
  windows excluded at write time.
- `events.jsonl` — one JSON object per line:
  `{ t: <ms>, castOffset: <ms>, kind: 'input'|'resize'|'step-start'|'step-end'|
     'action'|'assert', ... }` where `action` carries
  `{ api, selector?, ref?, ok, error? }`. `castOffset` positions the event on
  the (idle-trimmed, hide-window-adjusted) recording timeline; readers fall
  back to `t` when absent.

`SessionEventMap` `timeMs` semantics (binding for the driver): milliseconds
since session start, monotonic, never resets for the lifetime of a session
(reconnects included).
- `semantics.jsonl` — `{ t: <ms>, revision, castOffset: <ms>, snapshot }`,
  snapshot = `SemanticSnapshot` verbatim.

Writer/reader live in `@termwright/trace`; UI and HTML report consume only via
those readers.

## §UI events — runner ↔ browser

WebSocket, JSON messages `{ v: 1, type, ... }`:
- server→client: `run-start`, `test-start {id, title, file}`,
  `step {testId, title, phase}`, `output {sessionId, dataB64, t}`,
  `semantic {sessionId, revision, snapshot}`, `test-end {id, status, traceRef}`,
  `run-end {summary}`.
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
`/regex/`; omitted name matches any; omitted children = don't-care (partial
matching); `[state]` flags only assert listed flags. Serializer+matcher live in
`@termwright/test`; format shared with docs and UI inspector copy-paste.

## Definition of done (every package)

1. `pnpm build && pnpm typecheck && pnpm test` green in the package.
2. Public surface documented (TSDoc) and exported through `src/index.ts` only.
3. Unit tests cover the package's contract obligations, including error paths.
4. No TODO/stub left in exported code paths; internal TODOs tracked in the
   package's `NOTES.md` if any.
5. README.md in the package: purpose, install, 30-line usage example.
