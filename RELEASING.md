# Releasing Termwright

Termwright uses a Release PR. A maintainer starts one workflow, reviews the
versions, and merges the PR. The merge publishes every registry automatically.

## Release a version

1. Open **Actions → Release → Run workflow**.
2. Choose `main` and run it.
3. Review the generated `chore(release): version packages (main)` PR.
4. Wait for the normal CI checks, approve the PR, and merge it.

That merge is the release decision. The same `release.yml` workflow then:

1. verifies and packs the exact merged commit;
2. creates all coordinated tags and a draft GitHub Release;
3. publishes crates.io in dependency order;
4. publishes PyPI;
5. publishes npm;
6. confirms every registry and publishes the GitHub Release.

There is no separate tag, registry, or finalize workflow to dispatch. There is
also no registry token to rotate: npm, PyPI, and crates.io authenticate the
specific GitHub workflow through OIDC.

## How versions are selected

Feature and fix PRs add a changeset. The changeset names the affected packages
and whether each change is major, minor, or patch:

```sh
pnpm changeset
```

The Release workflow applies all pending changesets. npm packages are a fixed
group, so their versions move together. The wire protocol version is propagated
from `packages/protocol/package.json` to Python, all Rust crates, and the Go
module tag by `scripts/sync-protocol-version.mjs`.

If no changesets are pending, running Release is a successful no-op.

## Review the Version PR

The Version PR is the human approval gate. Check:

- package versions match the changeset intent;
- changelog entries describe user-visible changes;
- Python and Rust protocol manifests moved with `@termwright/protocol`;
- the lockfiles changed only as expected;
- every required CI check passed.

The generated PR is authored by GitHub Actions, so a maintainer can provide the
required review. Do not bypass the checks for a release.

## When publication fails

Use **Re-run failed jobs** on the failed Release run. Registry steps are
idempotent: an artifact that already exists is verified and skipped. Never move
an existing tag, overwrite an artifact, or yank a partial release merely to
restart the pipeline.

If the published artifact itself is wrong, fix it and release the next patch
version across every registry.

## Coordinated tags

One release commit receives:

| Tag | Purpose |
| --- | --- |
| `@termwright/<package>@X.Y.Z` | npm package source |
| `termwright@X.Y.Z` | umbrella npm package source |
| `protocol/vX.Y.Z` | release anchor and GitHub Release |
| `clients/go/vX.Y.Z` | Go module version |

Tags are created as one atomic push after all verification passes.

## Backports

Create `release/N.x` from the last tag in that line only when a backport is
needed. Add a changeset on that branch, then run **Release** with the matching
target. The generated Version PR targets the release branch. After merge, npm
uses the `N.x-lts` dist-tag and GitHub does not mark the backport as latest.

## Preview packages

For a pull request, add the `pr preview` label. `preview-release.yml` publishes
installable packages through pkg-pr-new without consuming a version or touching
npm. This is the preferred replacement for registry canaries.

## Trusted publishing setup

Registry publisher configuration is a one-time repository setup, not part of a
release:

| Registry | Packages | Trusted workflow | Environment |
| --- | --- | --- | --- |
| npm | every public package | `release.yml` | `npm-publish` |
| PyPI | `termwright` | `release.yml` | `pypi-publish` |
| crates.io | all three Rust crates | `release.yml` | `crates-publish` |

The environments restrict deployment identity, but the Version PR review is
the single manual approval. They must not add a second required-review gate.
The workflow needs `id-token: write` only in the registry job that uses it.

The repository's default Actions permission stays read-only. `release.yml`
grants write access only to the PR, tag, and release jobs that require it.

## Release workflow changes

Treat `.github/workflows/release.yml` as production code:

- require normal review and CI for modifications;
- keep registry code in separate least-privilege jobs;
- do not add long-lived registry tokens;
- preserve exact-commit checkout, artifact hashes, and already-published checks;
- update each registry's trusted publisher if the filename or environment
  changes.

Contributor guidance for writing changesets is in
[`.changeset/README.md`](.changeset/README.md).
