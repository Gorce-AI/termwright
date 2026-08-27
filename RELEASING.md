# Releasing Termwright

Termwright uses an autonomous, SHA-bound Version PR. A trusted coordinator
prepares it after candidate reconciliation finds pending changesets. That can
follow a merged compatibility PR or a no-change reconciliation against the
current `main` SHA. The coordinator reproduces the complete Version PR tree
from the trusted base, then merges and publishes only after the exact required
CI suite succeeds.

## Release a version

1. Observe the daily **Framework compatibility candidates** run.
2. If reconciliation changes compatibility data, follow its generated
   compatibility PR and exact dispatched CI run. If reconciliation produces no
   compatibility tree change, confirm the no-change reconciliation completed
   successfully.
3. When pending changesets exist, follow the generated
   `chore(release): version packages (main)` PR and its
   exact dispatched CI run.
4. Confirm that **Release publish** names the Version PR number and exact
   current default-branch SHA.

The trusted coordinator makes that merge only after every coded gate passes.
It also verifies the live default-branch protection contract and refuses to
advance while an earlier trusted Release run is active or failed.
It explicitly dispatches `release.yml` in `publish` mode; pushes never publish.
The workflow then:

1. independently reproduces the merged Version PR from its actual squash parent,
   then verifies and packs the exact merged commit;
2. creates all coordinated tags and a draft GitHub Release;
3. publishes crates.io in dependency order;
4. publishes PyPI;
5. publishes npm;
6. confirms every registry and publishes the GitHub Release.

There is no tag, registry, or finalize workflow to dispatch manually. There is
also no registry token to rotate: npm, PyPI, and crates.io authenticate the
specific GitHub workflow through OIDC. Do not manually dispatch `publish` as a
substitute for a failed coordinator gate.

## How versions are selected

Feature and fix PRs add a changeset. The changeset names the affected packages
and whether each change is major, minor, or patch:

```sh
pnpm changeset
```

The daily trusted coordinator also checks the exact current `main` commit when
there is no framework-compatibility update. If ordinary Changesets are pending,
it idempotently dispatches Release `prepare` for that SHA. This keeps normal
releases moving while unattended instead of coupling them to an upstream
framework release.

The Release workflow applies all pending changesets. npm packages are a fixed
group, so their versions move together. The wire protocol version is propagated
from `packages/protocol/package.json` to Python, all Rust crates, and the Go
module tag by `scripts/sync-protocol-version.mjs`.

If no changesets are pending, Release `prepare` is a successful no-op.

## Review the Version PR

The Version PR is an observable automation gate. The coordinator checks:

- package versions match the changeset intent;
- changelog entries describe user-visible changes;
- Python and Rust protocol manifests moved with `@termwright/protocol`;
- the lockfiles changed only as expected;
- every exact required CI job passed;
- the complete PR tree equals the trusted deterministic version transform.

The generated PR must be authored by GitHub Actions with the exact expected
head, base, title, and changed paths. Do not approve a bypass, weaken a check,
or merge it manually.

## When publication fails

The trusted coordinator never reruns failed jobs in the same Release run.
A failed, cancelled, or timed-out first attempt opens or updates one issue keyed
by the release SHA for manual intervention. Diagnose and fix the cause, then
start a new workflow run from a new commit; a rerun cannot certify or publish.
Registry steps remain idempotent so already-correct immutable artifacts are
verified and skipped. Never move an existing tag, overwrite an artifact, or
yank a partial release merely to restart the pipeline.

If the published artifact itself is wrong, fix it and release the next patch
version across every registry.

## Coordinated tags

One release commit receives:

| Tag                           | Purpose                           |
| ----------------------------- | --------------------------------- |
| `@termwright/<package>@X.Y.Z` | npm package source                |
| `termwright@X.Y.Z`            | umbrella npm package source       |
| `protocol/vX.Y.Z`             | release anchor and GitHub Release |
| `clients/go/vX.Y.Z`           | Go module version                 |

Tags are created as one atomic push after all verification passes.

## Backports

Unattended publishing is intentionally restricted to `main`. Do not dispatch a
backport through the default-branch flow or bypass its SHA checks. Supporting a
`release/N.x` line requires a reviewed workflow change that extends the trusted
coordinator, branch rules, dist-tag policy, and registry gates together.

## Preview packages

For a pull request, add the `pr preview` label. `preview-release.yml` publishes
installable packages through pkg-pr-new without consuming a version or touching
npm. This is the preferred replacement for registry canaries.

Preview and release workflows build all six native PTY packages before they
publish anything. A Windows preview is therefore the same complete package
shape as a release: addon, pinned `conpty.dll`, both required host
architectures for the x64 package, license, manifest, and SPDX record.

## Updating the Windows ConPTY runtime

The Windows runtime is an explicit supply-chain pin, not an install-time
download. Update `packages/pty/conpty-assets.json`, regenerate both package
bundles with `scripts/prepare-conpty-assets.mjs`, and review every changed hash,
license, and SBOM field. The package checker rejects extra, missing,
wrong-architecture, or digest-mismatched files.

Do not merge a runtime update until the exact bundle passes the Windows x64,
native ARM64, and x64-on-ARM64 jobs for Node 22 and 24, including Node and Bun
application writes, legacy Console API ordering, resize, alternate-screen,
pressure, and real EOF. These are behavioral certification gates for the
marker-authoritative contract; a valid Microsoft signature or matching file
hash alone is not sufficient. Missing or invalid assets must remain a startup
error—never restore the inbox conhost as a fallback.

## Trusted publishing setup

Registry publisher configuration is a one-time repository setup, not part of a
release:

| Registry  | Packages              | Trusted workflow | Environment      |
| --------- | --------------------- | ---------------- | ---------------- |
| npm       | every public package  | `release.yml`    | `npm-publish`    |
| PyPI      | `termwright`          | `release.yml`    | `pypi-publish`   |
| crates.io | all three Rust crates | `release.yml`    | `crates-publish` |

The environments restrict deployment identity. For unattended operation they
must not add a required-review prompt. The workflow needs `id-token: write`
only in the registry job that uses it.

npm trusted publishing is configured on an existing package, so a brand-new
public package name needs a one-time interactive bootstrap before its first
Version PR can merge. From a clean, reviewed `main` commit, build and pack that
package, publish its current pre-release version with `--access public` and 2FA,
then configure `release.yml` in the `npm-publish` environment as its trusted
publisher. Run `pnpm check:npm-release-readiness` afterward. Both Version PR CI
and the publish workflow fail closed while any public workspace package has no
registry name; this prevents discovering a missing trust anchor only after
tags, crates, or Python artifacts have already shipped.

Retries never treat version existence as success by itself. npm integrity,
the complete PyPI distribution file set, and crates.io checksums must match the
sealed artifacts produced from the exact merged SHA. A collision, partial
upload, or registry metadata outage fails closed instead of being skipped.

The repository's default Actions permission stays read-only. `release.yml`
grants write access only to the PR, tag, and release jobs that require it.

Set the required repository variable `UPSTREAM_COMPATIBILITY_OWNER` to a
stable, assignable GitHub user. The coordinator fails closed when it is absent
or malformed; falling back to the triggering scheduler or bot would make the
only vacation-mode failure notification silently unassignable.
Email and mobile delivery follow that user's GitHub notification settings.
Every 30 days without another tree change, the schedule proposes a dedicated
one-file heartbeat through the same exact-tree reproduction, full CI and
protected-merge path. Heartbeat merges explicitly do not dispatch Release.
GitHub nevertheless does not document bot commits as resetting its 60-day
public-repository inactivity counter, and a disabled schedule cannot revive
itself. For a hard 60+ day guarantee, an independent missing-run monitor or a
later manual workflow re-enable remains unavoidable.

For unattended merges, default-branch protection must require pull requests
and the exact strict CI contexts bound to the GitHub Actions app, but set approving reviews to **0**, disable
last-push and code-owner approval, and define no bypass allowance or push
restriction. Apply the protections to administrators as well. GitHub Actions cannot approve its own PR, so a one-review rule is
a deterministic vacation-mode deadlock rather than an extra automated gate.
The coordinator compensates by merging only its own exact bot branch after it
has reproduced the complete tree from trusted default-branch code and verified
every required check. Force pushes and branch deletion remain forbidden.

## Release workflow changes

Treat `.github/workflows/release.yml` as production code:

- require normal review and CI for modifications;
- keep registry code in separate least-privilege jobs;
- do not add long-lived registry tokens;
- preserve exact-commit checkout, artifact hashes, and already-published checks;
- preserve dispatch-only `prepare`/`publish` modes and the merged Version PR
  number plus current target SHA checks;
- update each registry's trusted publisher if the filename or environment
  changes.

Contributor guidance for writing changesets is in
[`.changeset/README.md`](.changeset/README.md).
