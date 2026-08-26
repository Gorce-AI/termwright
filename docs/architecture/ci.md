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
3. Windows native artifact production and consumers;
4. determinism, concurrency, process/resource/async-leak, fault and randomized-race barriers;
5. platform conformance and UI/framework adapter contracts;
6. clients, release hygiene, examples, vectors and website documentation.

The x64 and ARM64 ConPTY producers are independent. Only x64 Windows jobs need
the x64 producer; POSIX conformance has no Windows-artifact dependency. The
scheduled reliability workflow follows the same rule and downloads the x64
addon before its Windows soak. Bun and every GitHub action are pinned.
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

Job display names are an external contract: branch protection and the trusted
release coordinator consume them. Changes to the matrix must update the shared
coordinator contract and its synchronization tests in the same commit.

`certification gate` is the stable aggregate context. It runs with `always()`
after the entire DAG and succeeds only when every dependency succeeded. The
coordinator independently checks all expanded job names as defense in depth.
Branch protection requires this gate instead of maintaining a parallel list of
matrix-expanded contexts.

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
