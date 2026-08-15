# Changesets

Every user-visible change to a published package needs a changeset. Add one in
the same pull request as the change:

```sh
pnpm changeset
```

Pick the packages you touched, pick the bump, and write the entry for someone
reading the changelog — what changed and what they have to do about it, not
which files you edited.

## How a release happens

1. Pull requests land on `main`, each carrying its changesets.
2. `.github/workflows/release.yml` opens (or updates) a **Version Packages**
   pull request that applies every pending changeset: versions bumped,
   changelogs written.
3. Merging that pull request publishes to npm with provenance, and unblocks the
   PyPI, crates.io and Go jobs.

## The npm packages move together

`config.json` puts every `@termwright/*` package and the `termwright` umbrella
in one `fixed` group: they share a version and are released together. That is
deliberate — the driver, the adapters, the preset and the MCP server are one
product, and a matrix of independently drifting versions is a support burden
nobody asked for.

The language clients are versioned independently (they publish to different
registries) but are each bound to the **protocol** version.

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
