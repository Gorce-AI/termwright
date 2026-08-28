# CI architecture

The `CI` workflow is the pull-request certification boundary. Every job rejects
workflow reruns, disables test retries and snapshot updates, and records hidden
Termwright evidence where appropriate. A fail-then-pass diagnostic run remains
flaky and non-zero; GitHub does not provide a certifying yellow state.

`pnpm check:local` is the portable developer aggregate, not an alias for this
cross-platform DAG. It runs the checks available on the current machine,
including generated API-reference drift. Native Windows, OS/Node matrices and
the dedicated reliability lanes remain required CI evidence.

Native Host runs distinguish plain `passed`, amber `passed-with-skips`, and
fully `skipped`. A partial skip certifies only when observed identities match
the reviewed applicability/platform registries exactly; an all-skipped run or
policy mismatch remains red. Failed or cancelled run-producing jobs invoke the
shared hidden-file-aware uploader and retain `.termwright/runs` for seven days.
Successful matrix rows do not create empty evidence artifacts.

## Current DAG

Jobs are grouped conceptually even while they remain in one workflow:

1. static policy, package metadata and deterministic-core coverage;
2. supported Node/OS builds and hostile-input checks;
3. native PTY artifact production and real-host consumers;
4. determinism, concurrency, process/resource/async-leak, fault and randomized-race barriers;
5. platform conformance and UI/framework adapter contracts;
6. clients, release hygiene, examples, vectors and website documentation.

The Windows x64 and ARM64 PTY producers are independent and both execute the
real addon on their own architecture. Only x64 Windows consumers need the x64
producer; POSIX jobs compile and exercise their host addon without a Windows
artifact edge. The publish workflow separately builds, packs, clean-installs
and opens the macOS 13.5-targeted, Ubuntu 22.04 ABI-floor Linux, and Windows
x64/ARM64 artifacts on six native
runner rows before any registry write. The scheduled reliability workflow
downloads the x64 addon before its Windows soak. Bun and every GitHub action
are pinned.
The supported-runtime build matrix, examples lane, release verifier, daily
upstream-candidate certifier and the dedicated OpenTUI lane install Bun 1.4.0 and set
`TERMWRIGHT_REQUIRE_BUN=1`. The shared test-capability policy turns a missing or
deliberately disabled Bun runtime into a hard failure in those jobs. Local runs
may omit Bun; the genuinely Bun-only OpenTUI cases are then reported as exact
applicability skips, without manufacturing an inverse "Bun unavailable" test.

Workspace production build outputs are immutable inputs once the Native Host
starts. A complete root build records a content-addressed manifest over runtime
source, every build-reachable script and config, `dist` output, and declared
package-root runtime files and native binaries from `files`/`exports`. The root
`pretest` barrier verifies that whole manifest before starting the host; on a
fresh clone, or after a runtime
source/artifact change, it rebuilds the complete graph and records one new
manifest before any worker exists. CI uses that same root build contract.

Process-level probe tests then verify the current source fingerprint and the
exact entry files they consume. Missing, stale or post-build-modified inputs
fail with the required prebuild command. Tests never invoke package builds from
a Vitest worker: tools such as `tsup --clean` replace a shared directory and can
otherwise remove a preload while another project or example is executing it.

The supported-runtime build rows and the release verifier partition the root
Vitest workspace into three explicit Native Host invocations: `core`, general
package surfaces, and framework conformance plus examples. Every configured
project is named exactly once. A structural workflow test compares the
selectors with `vitest.config.ts`, so adding, removing or
renaming a project without updating the partition fails closed. Negated
selectors such as `--project=!core` are intentionally not used: they make a
growing, unrelated catalogue share one total-run safety boundary. Vitest file
sharding is also not used because it reports the unselected catalogue as skips
rather than defining independent project catalogues. Each invocation therefore
retains its own RunId, attempt journal, resource broker and fixed safety
boundary.

Job display names are an external contract: branch protection and the trusted
release coordinator consume them. Changes to the matrix must update the shared
coordinator contract and its synchronization tests in the same commit.

`certification gate` is the stable aggregate context. It runs with `always()`
after the entire DAG and succeeds only when every dependency succeeded. The
coordinator independently checks all expanded job names as defense in depth.
Branch protection requires this gate instead of maintaining a parallel list of
matrix-expanded contexts.

The coordinator validates the complete administrative branch-protection
resource before every autonomous merge. A dedicated GitHub App installed only
on this repository supplies a short-lived `Administration: read` token; it has
no write permission and is distinct from the workflow token used to merge. The
private key is held by the `trusted-autonomous-release` environment, whose
deployment policy selects exactly the `main` branch. Missing credentials,
an unreadable policy or any policy drift fails before merge. Immediately before
the merge request, the coordinator also requires the default branch to remain at
the PR's certified base SHA.

Provision that reader as a dedicated GitHub App with no webhook or subscribed
events, repository `Administration: read` as its only explicit permission, and
an installation limited to this repository. Store its App ID and private key as
the `BRANCH_POLICY_APP_ID` and `BRANCH_POLICY_APP_PRIVATE_KEY` secrets of the
`trusted-autonomous-release` environment, not as repository-level secrets. That
environment must use a selected-branch policy containing exactly `main`, with no
tag or wildcard policies. The pinned token action scopes
each short-lived token to the current repository and revokes it after the job.

## Why this remains one workflow

Moving jobs mechanically into independent workflow files changes check
contexts, prevents direct `needs`/artifact edges across workflow runs, and can
leave branch protection or the autonomous coordinator observing only part of
the result. The file's length is not sufficient reason to weaken that boundary.

## Target split

A follow-up may introduce `ci-core.yml`, `ci-platforms.yml`, and
`ci-reliability.yml`, but only through this migration:

1. extend the stable final gate to verify every expected source workflow and
   first-attempt conclusion for the exact commit;
2. teach the trusted coordinator the same versioned contract;
3. move artifact-coupled producer and consumer jobs together;
4. split files, verify the final gate on a PR, then remove obsolete contexts.

Until cross-workflow aggregation exists, reorganizing the DAG within `CI`
preserves both security and merge semantics.
