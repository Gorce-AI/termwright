# Changesets

Every user-visible change to a published package needs a changeset. Add one in
the same pull request as the change:

```sh
pnpm changeset
```

Pick the packages you touched, pick the bump, and write the entry for someone
reading the changelog — what changed and what they have to do about it, not
which files you edited.

CI enforces this: a pull request touching `packages/**` without a changeset
fails the `release-hygiene` check. Add the `release` label if the change
genuinely ships nothing.

## How a release happens

Changesets produce the versions and changelogs. The full runbook is
[`RELEASING.md`](../RELEASING.md); the short version:

1. Pull requests land on `main`, each carrying its changesets.
2. The trusted coordinator notices pending changesets on the exact current
   `main` SHA and idempotently dispatches `release.yml` in `prepare` mode.
3. The workflow applies the changesets and opens or updates the generated
   **Version PR**. The coordinator reproduces that complete tree from trusted
   base code and dispatches the exact required CI suite.
4. After every coded gate passes, the coordinator merges its exact Version PR
   and dispatches `release.yml` in `publish` mode, bound to the merged PR number
   and current default-branch SHA.
5. The workflow verifies and packs that exact commit, creates coordinated tags
   and a draft GitHub Release, publishes crates.io, PyPI and npm through OIDC,
   verifies every registry artifact, and only then publishes the GitHub Release.

Pushes never publish. Do not manually merge a Version PR or dispatch `publish`
to bypass a failed coordinator gate. A failed, cancelled, timed-out, or rerun
workflow attempt does not certify a release: fix the cause and start a new run
from a new commit. Publication is idempotent only when the already-published
artifact exactly matches the sealed artifact; collisions and partial uploads
fail closed.

`createGithubReleases` is set to `aggregate`: one GitHub Release describes the
whole coordinated bump rather than one release per package.

## The npm packages move together

`config.json` puts every `@termwright/*` package and the `termwright` umbrella
in one `fixed` group: they share a version and are released together. That is
deliberate — the driver, framework probes, annotation SDKs, preset and MCP
server are one product. Keeping one version makes compatibility easier to
understand and support.

The language clients publish to different registries. The PyPI package, all
three Rust crates and the Go module share the **protocol** version rather than
the npm group's. `scripts/sync-protocol-version.mjs` propagates it and CI checks
it. Coordinated npm and protocol tags are pushed atomically; registry publisher
identity comes from the specific GitHub workflow through OIDC, not long-lived
tokens. See [`RELEASING.md`](../RELEASING.md).

## Preview a pull request

Add the `pr preview` label when reviewers need installable packages. The preview
workflow publishes through pkg-pr-new without consuming a version, creating
release tags, or writing to npm. Do not create a registry canary instead.

## Published baseline

The coordinated `0.2.0` release is the current baseline. Every user-visible
change after it needs a changeset. If a user could notice a change in a public
package, include one.

## Not published

`@termwright/website`, `@termwright/performance`,
`@termwright/local-transport`, and everything under `examples/` are private
workspace tooling or implementation inputs. They are part of the repository,
not independently published packages.
