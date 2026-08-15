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

Changesets produce the versions and changelogs. They do **not** publish —
nothing in this repository does, automatically. The full runbook is
[`RELEASING.md`](../RELEASING.md); the short version:

1. Pull requests land on `main`, each carrying its changesets.
2. A maintainer dispatches `release-pr.yml`, which applies every pending
   changeset and opens the **Version PR**: versions bumped, changelogs written.
3. Merging that pull request **publishes nothing**. Someone then dispatches
   `tag.yml`, followed by the per-registry publish workflows, each behind an
   approval on its own environment.

`createGithubReleases` is set to `aggregate`: one GitHub Release describing the
whole coordinated bump, rather than eleven. `tag.yml` creates it as a draft, and
`finalize-release.yml` publishes it once every registry confirms the version.

## The npm packages move together

`config.json` puts every `@termwright/*` package and the `termwright` umbrella
in one `fixed` group: they share a version and are released together. That is
deliberate — the driver, the adapters, the preset and the MCP server are one
product, and a matrix of independently drifting versions is a support burden
nobody asked for.

The language clients publish to different registries, and the three that
implement the protocol — the PyPI package, the crate and the Go module — share
the **protocol** version rather than the npm group's. `scripts/sync-protocol-version.mjs`
propagates it and CI checks it; see [`RELEASING.md`](../RELEASING.md).

## The 0.1.0 baseline

The packages currently sit at `0.1.0` in their `package.json` and have never
been published, so the first release publishes those versions as they stand —
no changeset produces `0.1.0`, because changesets compute a bump *from* the
committed version.

Every change after that first publish needs a changeset. If you are unsure
whether something qualifies: a change that a user could notice does.

## Not published

`@termwright/website` and everything under `examples/` are ignored in
`config.json`. They are part of the repository, not part of the release.
