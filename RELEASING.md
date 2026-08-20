# Releasing termwright

**Nothing in this repository publishes automatically.** Every release to npm,
PyPI and crates.io is a workflow someone dispatches by hand, from a tag, through
a GitHub Environment with required reviewers. A merge to `main` ships nothing.

That is a deliberate constraint, not a missing feature. The workflows below are
built around it.

## The branch model

Trunk-based. `main` is always releasable, and a release is a decision to cut
from it rather than a state it enters on its own.

- **`main`** — protected. Required checks before merge: `build`, `conformance`,
  `hostile`, `clients`, `release-hygiene`, `website`. Linear history (squash or
  rebase); no merge commits.
- **`release/N.x`** — created **only when the first backport is actually
  needed**. Never up front. Cut it from the last tag of that line, cherry-pick
  onto it, and release from it with a non-`latest` dist-tag.
- **`release-pr/<target>`** — machine-owned. `release-pr.yml` force-updates it
  on every run; never commit to it by hand.
- **`next`** — reserved for changesets pre mode, if we ever run a long
  prerelease line. Not in use today; see [Prereleases](#prereleases).

## The four steps

Each is a separate manual workflow. Steps 3a–3c each require an approval on
their environment.

| # | Workflow | What it does | Publishes? |
|---|---|---|---|
| 1 | `release-pr.yml` | Applies the changesets on a branch, opens the Version PR | no |
| 2 | `tag.yml` | Tags the merged commit, creates a **draft** GitHub Release | no |
| 3a | `publish-crate.yml` | crates.io, in dependency order: protocol → Ratatui probe → Ratatui SDK | **yes** |
| 3b | `publish-pypi.yml` | PyPI | **yes** |
| 3c | `publish-npm.yml` | npm | **yes** |
| 4 | `finalize-release.yml` | Publishes the release notes once all three registries confirm | no |

### 1. Open the Version PR

Dispatch **Release PR** with `target` = `main` (or a `release/N.x` branch).

It runs `changeset version`, propagates the protocol version into the Python,
Rust and lockfile manifests, refreshes `pnpm-lock.yaml`, and opens
`release-pr/<target>`. Re-dispatching force-updates the branch, so a changeset
that lands late is picked up by running it again.

Review the PR as you would any other: the versions and the changelog entries are
the product here. Merge it when it reads right.

### 2. Tag

Dispatch **Tag release** with `ref` = the merged commit (usually `main`).

It refuses to run if any changeset is still unapplied, verifies the protocol
lockstep, then creates:

| Tag | Meaning |
|---|---|
| `@termwright/<pkg>@X.Y.Z` | one per npm package, from `changeset tag` |
| `termwright@X.Y.Z` | the umbrella package |
| `protocol/vX.Y.Z` | **the release anchor** — the `ref` you pass to every publish workflow |
| `clients/go/vX.Y.Z` | how a Go module in a subdirectory is published; the tag *is* the release |

It also opens a **draft** GitHub Release on the anchor tag. Draft, because
release notes that announce a version nobody can install are worse than no
notes.

### 3. Publish, in this order

**crates.io → PyPI → npm.** The order is by reversibility: a crates.io release
can only be yanked, never replaced, so it goes first — if it fails, nothing else
has shipped yet. npm goes last because it is the one registry with a staging
buffer.

For each: select `protocol/vX.Y.Z` as the workflow's own **Run workflow from**
ref and also pass that same tag as the `ref` input. This makes GitHub/npm/PyPI
provenance name the commit that was actually packed. Run **`dry_run: true`
first**, read the summary, then dispatch again with `dry_run: false` and approve.

GitHub's web form only offers branches in its **Run workflow from** dropdown,
so stable publishes must be dispatched through `gh` (or the REST API), which
can bind the workflow itself to a tag:

```sh
tag=protocol/vX.Y.Z
gh workflow run publish-crate.yml --ref "$tag" -f ref="$tag" -f dry_run=true
gh workflow run publish-pypi.yml  --ref "$tag" -f ref="$tag" -f dry_run=true
gh workflow run publish-npm.yml   --ref "$tag" -f mode=release -f ref="$tag" \
  -f dry_run=true -f dist_tag=latest
# After approving and reviewing the dry runs, repeat each with dry_run=false.
gh workflow run finalize-release.yml --ref "$tag" -f ref="$tag" \
  -f allow_partial=false -f mark_latest=true
```

Every publish workflow has a `verify` job that runs before the environment gate:
it builds and tests, checks the tag against the manifests, checks the protocol
lockstep, and checks whether the version is *already on the registry* — in which
case the publish job skips instead of failing.

`publish-npm.yml` takes a `dist_tag` (default `latest`). Releasing from a
`release/N.x` branch, set it to something like `0.x-lts` so the backport does
not move `latest` backwards.

### 4. Finalize

Dispatch **Finalize release** with the anchor tag. It queries all three
registries for the version and publishes the draft notes only if every one of
them has it. `allow_partial: true` publishes anyway and appends what is missing
to the release body — for the case where a registry is down and the notes matter
more than the wait. Set `mark_latest: false` for a backport so an older release
line cannot replace the current GitHub Release badge.

## When one registry fails

This is the case the design is shaped around, so it has one rule:

> **Re-dispatch the failed registry. Never yank, never republish, never roll back
> the ones that succeeded.**

A partial release is not a broken state. Version `X.Y.Z` existing on crates.io
but not yet on npm is a release in progress; the fix is to finish it. If the
failure turns out to be in the artifact itself, the fix is the **next patch
version, everywhere** — a yank in reaction to a partial failure breaks the
people who already installed successfully, to fix nobody.

The publish workflows are idempotent by construction: each one skips a version
that is already on its registry, so a re-dispatch after a partial success is a
no-op for the parts that worked.

Two specifics worth knowing:

- **crates.io can report a timeout for an upload that landed.** `cargo publish`
  waits on the index. Check crates.io before concluding anything, then
  re-dispatch — the already-published check makes it safe.
- **npm publishes package by package.** A failure halfway leaves some packages
  published. Re-dispatch: the skip logic handles it.

## Protocol lockstep

Six packages implement or ship the same wire protocol and **share one version**:

| Package | Registry | Version lives in |
|---|---|---|
| `@termwright/protocol` | npm | `packages/protocol/package.json` (source of truth) |
| `termwright` | PyPI | `clients/python/pyproject.toml` |
| `termwright-protocol` | crates.io | `clients/rust/Cargo.toml` + `Cargo.lock` |
| `termwright-probe-ratatui` | crates.io | `clients/rust-probe/Cargo.toml` + `Cargo.lock` |
| `termwright-ratatui` | crates.io | `clients/rust-ratatui/Cargo.toml` + `Cargo.lock` |
| `clients/go` | Go modules | nothing — the tag `clients/go/vX.Y.Z` *is* the version |

```sh
node scripts/sync-protocol-version.mjs           # propagate from npm to the rest
node scripts/sync-protocol-version.mjs --check   # verify; exits 1 on drift
```

The `release-hygiene` job in CI runs `--check` on every pull request, so a drift
fails review rather than a release.

**Everything else on npm versions independently**, through changesets. Lockstep
is a promise about the protocol — that a Python adapter and a TypeScript driver
carrying the same version speak the same wire format — not a release train for
the whole monorepo. The npm packages do move together as a `fixed` group, which
is a separate decision, documented in [`.changeset/README.md`](.changeset/README.md).

## Trusted publishing (OIDC)

No registry tokens are stored in this repository. Every publish authenticates
through OIDC, which has consequences worth knowing before the first release:

- **GitHub-hosted runners only.** A self-hosted runner cannot mint the token.
- **npm needs npm >= 11.5.1 and Node >= 22.14.** The workflow asserts the npm
  version rather than assuming it, because an older npm silently falls back to
  token auth and fails with a much worse message. Classic npm tokens were
  revoked in December 2025.
- **Stable-release provenance is automatic** with OIDC; there is no separate
  flag to remember. Canary mode disables it because its source ref can differ
  from the workflow ref.
- **crates.io refuses OIDC from `pull_request_target` and `workflow_run`.**
  Another reason every publish workflow is dispatch-only.

### First-publish checklist

A trusted publisher is configured **per package**, and it cannot be configured
before the package exists on the registry. So the first release of any package
is manual, and everything after it is the pipeline.

- [ ] **npm** — publish each package once by hand (`npm publish --access public`
      from a maintainer account with 2FA), then, on npmjs.com, add a trusted
      publisher for each: repository `gorce-ai/termwright`, workflow
      `publish-npm.yml`, environment `npm-publish`.
- [ ] **PyPI** — create the `termwright` project, then add a trusted publisher:
      owner `gorce-ai`, repository `termwright`, workflow `publish-pypi.yml`,
      environment `pypi-publish`.
- [ ] **crates.io** — publish `termwright-protocol`,
      `termwright-probe-ratatui`, then `termwright-ratatui` once by hand, and
      add the trusted publisher for `publish-crate.yml` to each crate.
- [ ] **GitHub Environments** — create `release-tag`, `npm-publish`,
      `pypi-publish` and `crates-publish`, each with required reviewers. This is
      the approval gate; without protection an environment name alone does not
      make a workflow controlled.

Note also that npm's **staged publishing does not apply to a package's first
release**. From `0.1.1` onward the staging buffer is available; for `0.1.0` it
is not, which is one more reason the first publish is a deliberate manual act.

## Prereleases

Three mechanisms, in increasing order of commitment:

**Pull-request previews** — add the `pr preview` label. `preview-release.yml`
builds the packages and publishes them to pkg-pr-new, so a reviewer can install
the PR directly. Nothing reaches npm and no version is consumed. Opt-in per PR
on purpose: a preview of everything is noise, and an install command built from
an unreviewed fork is not something to hand out by default.

**Canary snapshots** — dispatch the trusted `publish-npm.yml` definition from
`main`, with `mode: canary`, `ref` set to the source branch/commit, and
`canary_tag` left as `canary` (or a `canary-*`/`canary.*` label). This is a real npm publish
of `0.0.0-canary-<timestamp>` under that canary dist-tag, without consuming the
pending changesets. `latest` is never moved, so nobody picks one up by accident.

Canary shares `publish-npm.yml` deliberately: npm permits only one trusted
publisher workflow per package. Its source build and package lifecycle run in
an unprivileged job; only a fixed allowlist of immutable tarballs crosses into
the approved OIDC job. Canary artifacts are unsigned because GitHub's automatic
npm provenance would describe the workflow dispatch ref, which can differ from
the separate canary source ref.

```sh
gh workflow run publish-npm.yml --ref main -f mode=canary -f ref=my-branch \
  -f canary_tag=canary -f dry_run=true
# Review and approve the dry run, then repeat with dry_run=false.
```

**Pre mode** (`changeset pre enter`) — for a sustained prerelease line, e.g. a
long-running `2.0.0-next.N`. Not in use, and if we start, it belongs on a `next`
branch: pre mode is sticky, and running it on `main` blocks ordinary patch
releases for as long as it is on.

## Backporting

1. Create `release/N.x` from the last tag of that line — at the moment the first
   backport is needed, not before.
2. Cherry-pick the fix. Add a changeset on the branch.
3. Dispatch `release-pr.yml` with `target: release/N.x`, merge, then `tag.yml`
   against that branch.
4. Publish with **`dist_tag: N.x-lts`**, so `latest` keeps pointing at the
   current line.
5. Finalize with **`mark_latest: false`**, so GitHub also keeps the current line
   marked as latest.

## Quick reference

```
release-pr.yml     target=main                                  -> Version PR
  (merge)
tag.yml            ref=main                                     -> protocol/vX.Y.Z + draft release
publish-crate.yml  run-from+ref=protocol/vX.Y.Z  dry_run=true, then false
publish-pypi.yml   run-from+ref=protocol/vX.Y.Z  dry_run=true, then false
publish-npm.yml    mode=release, run-from+ref=protocol/vX.Y.Z, dist_tag=latest
publish-npm.yml    mode=canary, ref=<branch/sha>, canary_tag=canary
finalize-release.yml run-from+ref=protocol/vX.Y.Z  mark_latest=true -> notes go live
```

Contributor-facing guidance (when a changeset is required, how to write one)
lives in [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`.changeset/README.md`](.changeset/README.md).
