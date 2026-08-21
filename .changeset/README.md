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
2. A maintainer dispatches `release.yml`, which applies every pending
   changeset and opens the **Version PR**: versions bumped, changelogs written.
3. A maintainer reviews and merges the Version PR after CI passes.
4. That merge runs `release.yml` again. It tags the exact merge commit,
   publishes crates.io, PyPI and npm through OIDC, then publishes one GitHub
   Release after every registry confirms the version.

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
it; see [`RELEASING.md`](../RELEASING.md).

## Published baseline

The coordinated `0.2.0` release is the current baseline. Every user-visible
change after it needs a changeset. If a user could notice a change in a public
package, include one.

## Not published

`@termwright/website` and everything under `examples/` are ignored in
`config.json`. They are part of the repository, not part of the release.
