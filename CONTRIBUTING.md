# Contributing to termwright

Thanks for being here. This file is the short version of how the repository
works; the long version is [`CONTRACTS.md`](CONTRACTS.md), which is normative.

## Getting set up

```sh
pnpm install
pnpm check:fast
pnpm check:local
```

`pnpm install` prepares the workspace; `check:fast` is the review loop and
`check:local` is the complete local check. Cross-platform, native Windows and
language-client certification remains the responsibility of the CI workflow.
Run `pnpm format` for the repository-wide Prettier pass and `pnpm lint:fix` for
safe ESLint fixes; both are verified by `pnpm check:fast`.
Node 22 or 24 and pnpm 9 are required. Most integration suites need a real pseudo-terminal and
skip themselves where none can be opened; `TERMWRIGHT_SKIP_PTY=1` skips them
explicitly. A run where everything skipped is not a passing run.

## Contracts come first

Some interfaces are normative, and each has exactly one owner file:

| Contract                      | Normative location             |
| ----------------------------- | ------------------------------ |
| Semantic wire protocol        | `packages/protocol/src/*.ts`   |
| Driver public API             | `packages/driver/src/api.ts`   |
| Trace archive format          | `CONTRACTS.md` §Trace          |
| UI ↔ runner event protocol    | `CONTRACTS.md` §UI events      |
| MCP tool surface              | `CONTRACTS.md` §MCP            |
| Semantic YAML snapshot format | `CONTRACTS.md` §YAML snapshots |

Changing one means: **update the normative file first**, note the change in
[`CHANGELOG-contracts.md`](CHANGELOG-contracts.md), then adapt the consumers.
Never fork a contract locally — a second copy of a rule is a second answer to
the same question.

## Dependency rules

Enforced by review, and load-bearing: they are what lets someone install the
driver in a project that has never heard of React.

- `protocol` depends on `zod` only — never on React, Ink, MCP, PTY or the driver.
- `driver` depends on `protocol` plus the PTY and VT libraries — never on Ink,
  Vitest or MCP.
- **Adapters** (`ink`, `opentui`, the language clients) depend on `protocol` and
  their framework — **never on the driver**.
- `test` depends on `driver` (+ `trace`, + protocol types), with `vitest` as a
  peer.
- `mcp` depends on `driver` and the MCP SDK behind `src/sdk-facade.ts`, and owns
  no session logic of its own.
- `trace` consumes driver types; `ui` depends on `trace` and `driver` and talks
  to Vitest only through our own event protocol.
- `conformance` may depend on everything; nothing depends on it.

## Engineering baseline

ESM only, TypeScript strict per `tsconfig.base.json`, built with tsup, tested
with Vitest (`*.test.ts` next to the source). No default exports. No `any` in a
public surface. Every public function and type gets TSDoc. Errors thrown across
a package boundary are `TermwrightError` subclasses. All I/O is bounded by
`DEFAULT_LIMITS` / `ABSOLUTE_LIMITS`, and hostile-input suites must pass under
`node --max-old-space-size=128`.

## Definition of done

A package change is done when:

1. `pnpm check:fast` and the relevant package tests are green, followed by
   `pnpm check:local` before handoff;
2. the public surface is documented and exported through `src/index.ts` only;
3. unit tests cover the contract obligations, including the error paths;
4. no TODO or stub is left in an exported code path (internal TODOs belong in
   the package's `NOTES.md`);
5. the package README covers purpose, install and a usage example.

### One extra obligation for adapters

A TypeScript adapter needs at least one test calling `validateSnapshot` on a
snapshot its collector returned **in memory**, with no serialization anywhere in
between. The obligation is about the path, not the fixture: a big tree proves
nothing if the value being validated has been through JSON.

Framing is `JSON.stringify`, which erases reference identity, so a test that
only inspects what arrived over the socket cannot see aliasing — two nodes
sharing one `actions` array pass on the wire and are rejected in-process by
`mountInk` or a `getTree` response. Both shipped adapters learned this from a
real bug. The language clients serialize on the way out, so it cannot happen to
them.

## Two habits that matter more than they look

**Never wait by sleeping.** Every wait is driven by a screen revision, a
semantic revision or a process event. A `setTimeout` in a test is a bug report
about a missing wait.

**Degrade honestly.** Where something cannot be observed, say so in a typed
error or a diagnostic — `semanticTree: false`, `capability-unavailable`,
`stale-snapshot`. Never infer a role from rendered text, and never send input
nothing will read. A locator that silently matches the wrong cell turns a test
suite into a source of false confidence, which is worse than no suite.

## Working in a shared tree

This repository is worked on by several people and agents at once, and the git
index is shared. [`CONTRACTS.md` §Git hygiene in this shared
tree](CONTRACTS.md#git-hygiene-in-this-shared-tree-binding-for-every-agent) is
binding: commit with explicit paths, never `-a`, never `--amend`, never rewind
the whole tree.

Do not add `Co-Authored-By` trailers to commit messages. Termwright records the
author and committer supplied by Git and does not use co-author trailers.

**Bisecting:** commit `1c0442a` does not build on its own for the `termwright`
package. Its build script compiles `src/reporter.ts` and `src/ui-reporter.ts`,
and neither file exists at that commit — the manifest was committed ahead of its
sources when two agents shared an index. It is an artifact, not a product
regression, so `git bisect skip` it rather than chasing the failure.

## Reviewing DX: run it, do not read it

When checking whether a feature is actually usable — not whether the code is
correct, but whether a person can reach it — **describe the behaviour from the
user's side and verify it by running the thing**. Reading the implementation is
what makes this kind of review miss.

Four real examples, each found by running a command and none visible in a code
read:

- the runner's auto-open and test discovery both worked in the library and were
  never wired into the CLI. The call sites looked right; the option simply was
  never passed;
- `termwright usage` printed the MCP cheat sheet instead of the CLI's. It calls
  a real builder, correctly;
- a missing archive exited **5 (internal)** where a mistyped path is a **2
  (usage)** error. The error was raised properly, into the wrong branch of a
  taxonomy we document as a contract;
- the runner UI's `close()` waited on connections the browser was holding open,
  so a suite with every test green timed out in teardown.

The method, in order:

1. list what the READMEs and docs _promise a user can do_;
2. for each promise, run the command a user would run;
3. classify: **reachable**, **library-only on purpose** (with a link to where
   that is documented), or **gap** (with a suggested command or flag);
4. report gaps rather than fixing them — some are product decisions.

A gap that turns out to be deliberate is worth a sentence in the docs, so the
next reviewer does not re-file it.

## Changesets

Every user-visible change to a published package needs one:

```sh
pnpm changeset
```

Write the entry for someone reading the changelog — what changed and what they
have to do about it. CI enforces this: a pull request touching `packages/**`
with no changeset fails `release-hygiene`.

All the npm packages share a version and release together; see
[`.changeset/README.md`](.changeset/README.md). Adding a changeset does not
release anything by itself — publishing requires the autonomous exact-SHA,
full-CI Release PR gates documented in [`RELEASING.md`](RELEASING.md).

## Writing an adapter

Adapters live happily outside this repository. The five wire obligations, the
six semantics conventions, the traps, and how to certify in any language are
documented at
[Writing an adapter](https://gorce-ai.github.io/termwright/adapters/writing-an-adapter/).
If yours passes `runAdapterConformance`, open an issue — being on the adapter
list is the point of certifying.

## Docs

The site lives in [`website/`](website) (Astro Starlight) and deploys to GitHub
Pages from `main`.

Substantial documentation changes must follow the canonical
[`Termwright documentation guide`](docs/DOCUMENTATION_GUIDE.md). It defines the
audience, page types, information architecture, tone, example validation,
screenshot workflow, and review checklist. Keep that file as the single source
of truth instead of copying its rules into contributor or agent instructions.

```sh
pnpm --filter @termwright/website run dev
pnpm --filter @termwright/website run build
pnpm --filter @termwright/website run check:links
```

Code samples in the docs are taken from `examples/` and the package READMEs.
Please do not write a snippet against an API you have not run.
