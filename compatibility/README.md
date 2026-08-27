# Compatibility registry

[`registry.json`](registry.json) is the single source of truth for framework
compatibility. It separates a package's declared range from versions actually
verified by fixtures/audits, and binds the exact producer facts carried by the
`hello` handshake into the executable protocol capability graph:

- `probe.capabilities` describes observable probe facts (`hello.probe`);
- `probe.adapterCapabilities` describes the one certified message contract on
  `hello`; structural variants are forbidden.

Copy-based probes also list every checksummed module patch. Optional annotation
APIs and known limitations belong in the framework row rather than in a second
hand-maintained matrix.

Schema v6 binds each executable row to:

- the exact `certification.ids` emitted by the frozen session contract and the
  checksum profile or patch manifests that justify them;
- the `automatic`, `applicationIntegrated`, `terminal`, and `unsupported`
  partition of every frozen session capability;
- accepted provider facts and language-native SDKs;
- terminal runtime prerequisite IDs, kept separate from static support;
- mandatory conformance claim IDs and the real executable files proving them.

CI rejects graph orphans, impossible remediation, missing checksum sources,
nonexistent claim files, certification IDs that drift from verified versions,
or provider support without a producer-to-session graph edge. The website
tables and remediation text are generated from the same graph, while Runner
displays the negotiated instance rather than copying a capability matrix.

[`framework-semantic-completeness.json`](framework-semantic-completeness.json)
is a generated, machine-readable projection of every exact adapter row. It
records upstream/probe facts, automatically portable capabilities,
application-provider additions, runtime input prerequisites, facts retained
only as extended/diagnostic evidence, remaining automatic limits, and the
executable claim files. It introduces no second source of truth: CI regenerates
it from `registry.json` and rejects drift.

Validate a change with:

```sh
pnpm run test:compatibility
pnpm run check:semantic-completeness
```

The test compares package versions, patch manifests, framework detection and
runtime handshake declarations. The documentation site imports this JSON to
render `/reference/compatibility/` and publishes the same data at
`/compatibility/registry.json` with [`schema.json`](schema.json) beside it.

## Daily upstream compatibility workflow

[`upstream-patches.json`](upstream-patches.json) lists every monitored upstream
and its explicit integration strategy plus a `certificationRevision`. Runtime hooks use capability and
behavioral certification; exact-source hooks and copied Go/Rust modules retain
their checksum-bound instrumentation profiles. [`certified-upstreams.json`](certified-upstreams.json)
is the merge-reviewed allowlist of releases that completed the appropriate
workflow. [`candidate-assessments.json`](candidate-assessments.json) separately
records exact red candidate digests; a red assessment never declares support.

The scheduled workflow runs every day and can also be started with
`workflow_dispatch`. Discovery computes the set difference between every stable
release at or above a stream's support floor and the certified ledger. It does
not ask only for the registry's latest version. A patch release published after
a newer minor, such as `2.1.1` after `2.2.0`, remains a candidate.

Candidates remain oldest-first within each stream. The bounded scheduler takes
one candidate from every pending stream before assigning a second slot to any
stream. The scheduled capacity is 16, currently enough to visit every stream;
a manual dispatch accepts a bounded capacity up to 32 and may select one exact
stream for focused backlog certification. This
prevents one incompatible backlog from starving another framework without
giving an upstream registry unbounded test concurrency.

An exact red digest at the current `certificationRevision` is not selected
again. Discovery compares the registry's lightweight release identity with the
stored checksum-bound source before scheduling; it does not download an
unbounded history of unchanged red artifacts. A changed root release identity
or prepared patch is tested again automatically. Transitive npm closure drift is
continuously checked for certified releases, where Termwright makes a support
claim; red assessments make no support claim and remain dormant until the root
identity, patch, or certification revision changes. When adapter or certifier
behavior changes, increment that stream's revision: every red assessment from
the older revision then becomes eligible again. Red assessments remain visible
as owned issues; a later green result removes the assessment and the issue
closes only after the support allowlist PR merges.

Treat a revision increment as part of the probe or certifier change that makes
the old red result obsolete. Increment only the affected streams and review the
old and new values explicitly; the revision is not a retry counter. A shared
runtime or build-injection refactor may require a coordinated increment across
several affected streams so discovery can reconsider each previously suppressed
candidate under the new implementation.

Each candidate records immutable source evidence:

- Go module `Sum`, `GoModSum`, and the SHA-256 of the proxy zip;
- the crates.io archive checksum;
- for monitored npm integrations, every resolved production, optional, peer,
  nested, and platform package's exact name, version, integrity, tarball
  SHA-256, exact edges, and one canonical closure digest;
- the SHA-256 of the exact local patch manifest, when it exists;
- a digest of the complete canonical candidate record.

Changing a transitive npm resolution therefore makes the same root package
version a new candidate. Unsupported selectors and bundled dependencies fail
discovery; they are never omitted from a supposedly complete closure.

Source downloads and tests run in a job with `contents: read`. A separate
`workflow_run` coordinator checks out only the current default branch and then
downloads artifacts from the exact completed run. It rejects a stale SHA,
another repository, or a non-default source branch before reconciling. No job
that has a write token checks out or executes a pull-request branch.

### Candidate outcomes

For source-patched Go and Rust integrations, a missing exact manifest starts a
deterministic preparation against the exact downloaded source. T1 Go
candidates, including tview, tcell and Bubbles, generate no patch bundle: the
owned add-only units must compile against the resolved package through the
official tool-executor seam and then pass candidate-specific real-process and
conformance gates. Missing symbols, missing injection or ambiguous module
resolution are red; they never create an exact source profile.

Ink still requires exact source-hook instrumentation. Its candidate job
extracts the checksum-verified npm archive, computes both audited artifact
SHA-256 values and proves both transforms against that exact source. A green,
revision- and candidate-bound profile is the only way reconciliation may
extend Ink's instrumentation allowlist.

OpenTUI uses a runtime hook. The candidate job installs the exact verified
tarball and checksum-bound production dependency closure, requires real Bun,
passes a version/digest/revision-bound temporary admission to the probe, and
runs package behavior plus full conformance. A green result contains only a
version profile for `certified-runtime.json`; no chunk name, source anchor or
bundle digest is generated or retained. Textual uses capability and behavioral
admission directly: the candidate job installs the checksum-bound Python
artifact and must pass the full Python probe and cross-language conformance
suites. A green outcome is recorded in the candidate ledger; it does not
generate an allowlist, repin the Python extra or change the probe pipeline.

Any failure opens or updates one `upstream-compatibility` issue keyed by stream
and version. A separate dead-man issue covers discovery/setup failures that
happen before the candidate registry or verdict artifacts exist. The workflow
does not reinterpret checksum mismatches or mark a release as verified.

When an exact manifest exists, the existing upstream certifier:

1. binds registry declarations and patch manifests;
2. applies the patch twice in clean directories and compares complete tree
   digests;
3. runs the relevant probe suites;
4. runs the full conformance matrix and refuses a run where an entire required
   area skipped.

tview/tcell certification is conjunctive across native Linux and Windows jobs.
The Windows job uses the repository's compiled x64 ConPTY addon, launches the
fixture with `NewConsoleScreen` on the real console handle, observes the first
semantic tree and proves a later tree is caused by fixture input. A verdict
from either platform cannot substitute for the other.

Copy-patch declarations and executable framework combinations are separate in
`registry.json`. A deterministic patch application adds only an exact
`patchSets` declaration. The coordinator records an executable `variant` only
after a candidate-specific real-process test launches that exact dependency
resolution through Termwright, observes semantics, exercises input, and the
full relevant conformance gate passes. Companion versions are recorded from
the graph that was actually executed; no untested cross-product is implied.

Only a matching green verdict can update `certified-upstreams.json`. The
trusted coordinator pushes that update to
`automation/framework-compatibility` and creates or updates a PR. It never
pushes the default branch. Red or missing verdicts can only produce an issue,
assigned to the configured compatibility owner and linked to the exact
certification run.

Discovery and reconciliation always begin from the trusted default-branch
ledger. An open automation PR may therefore re-certify the same bounded batch,
but it can never become an input to a later trusted run. This intentional extra
work keeps the result reproducible from one default-branch SHA and one exact
source run.

The coordinator explicitly dispatches `ci.yml` for the exact automation-branch
SHA. It enumerates the complete required CI job set, verifies the PR head, base,
repository, bot author, exact title, changed-file allowlist, regular-file modes,
and bounded blob sizes. A read-only coordinator then downloads the exact source
run named by the PR, repeats reconciliation from the trusted base, and requires
the complete Git tree to match before the write-token job can squash-merge that
SHA. All coordinator events serialize as one repository-wide state machine.
When reconciliation produces no framework change, that same serialized run
checks the exact current default-branch SHA for ordinary pending Changesets and
idempotently dispatches Release `prepare`; it never dispatches for a stale SHA.

Before every merge, the coordinator also reads branch protection and fails
closed unless required checks are strict/current, the complete CI job set is
present, pull requests are required without bypass allowances, and force-push
and deletion are disabled. The latest trusted Release run must be successful
before the next automation PR may merge, so a partial release cannot be
leapfrogged.

The compatibility merge explicitly dispatches Release in `prepare` mode for
the exact merged SHA. The generated Version PR receives another exact CI
dispatch. Before merging it, a read-only coordinator job reproduces
`changeset version`, protocol synchronization, and lockfile generation from
the trusted base, and requires the complete Git tree ID to match. The
write-token job never executes the Version PR. Its exact squash result is
explicitly dispatched to Release in `publish` mode; a push event never
publishes. Before any tag or OIDC job, Release independently repeats that full
tree reproduction from the squash parent, so a manual dispatch cannot bypass
the coordinator's proof. Exact run names make both dispatches idempotent
without duplicating a release.

A failed, cancelled, or timed-out Release run is never retried automatically.
The coordinator opens or updates one SHA-keyed issue for maintainer
intervention. This keeps a failed certification attempt visible and prevents a
test flake from becoming a successful publication on a later workflow attempt.

External actions in the certification, CI, coordinator, and release trust path
are pinned to complete commit SHAs. Certification and CI checkouts do not
persist Git credentials, and dynamically selected npm candidates are installed
with lifecycle scripts disabled before their deliberate read-only conformance
execution.

### Maintainer procedure

1. Open the generated issue and inspect the exact source identity and expected
   manifest path.
2. Audit the new upstream internals. Add a new exact patch directory and update
   `registry.json`; never edit an older checksummed patch in place.
3. Run:

   ```sh
   pnpm exec vitest run scripts/discover-framework-candidates.test.mjs \
     scripts/certify-framework-candidate.test.mjs \
     scripts/reconcile-framework-candidates.test.mjs \
     scripts/certify-upstream-patches.test.mjs
   pnpm run test:compatibility
   ```

4. Dispatch **Framework compatibility candidates** with a small maximum while
   reviewing a new patch.
5. Observe the automation PR and linked runs. The trusted coordinator merges
   only the exact fully green result and continues the release flow. If a gate
   is red, fix the named cause and rerun; never bypass or remove the gate.

Scheduled workflows run from the default branch and may be delayed under
Actions load. The fixed concurrency group prevents overlapping reconciliation.
Job-level permissions implement GitHub's least-privilege recommendation. See
[scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions),
and [concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

### Required repository settings

The workflows do not mutate repository settings. Before enabling unattended
runs, an administrator must verify that:

- Actions may create pull requests with `GITHUB_TOKEN`, while the repository
  default token permission remains read-only;
- required repository variable `UPSTREAM_COMPATIBILITY_OWNER` names one
  explicit assignable user; there is deliberately no scheduler/bot fallback,
  because that can make failure alerts silently unassignable
  who receives compatibility and exhausted-release issue notifications;
- the default branch requires pull requests, the exact CI job set bound to the
  GitHub Actions app, and a current branch, applies protection to
  administrators, and disallows force-push and deletion; the GitHub Actions bot may
  merge a compliant PR but cannot bypass those rules;
- `release-tag`, `npm-publish`, `pypi-publish`, and `crates-publish`
  environments exist, admit only `release.yml`, and do not add an unattended
  approval prompt;
- npm, PyPI, and crates.io trusted publishers bind the exact repository,
  `release.yml`, and corresponding environment, with no long-lived token;
- organization Actions policy permits the pinned action commits used here.

Issue assignment is the durable in-repository alert, but delivery by email or
mobile push still follows that user's GitHub notification settings.

When no compatibility or release work changed the tree for 30 days, the daily
run creates `automation/workflow-heartbeat`. That one-file PR is source-run/SHA
bound, reproduced from the trusted base, and must pass the same complete CI and
branch-protection contract. Its merge path explicitly suppresses release
dispatch, so it cannot version or publish packages.

This is defense in depth, not a platform guarantee. GitHub documents that a
public repository's schedules are disabled after 60 days without repository
activity, but does not promise that commits made by `GITHUB_TOKEN` reset that
counter. Once the schedule is disabled, it cannot run code to re-enable itself.
Therefore a fully unattended 60+ day absence still needs an independent
heartbeat or later manual re-enable; the repository-native loop cannot remove
that hard platform dependency. See [GitHub's scheduled-workflow warning](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).
