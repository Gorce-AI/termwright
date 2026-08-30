# One-time npm package bootstrap

This procedure creates the eleven package names that predate npm trusted publishing. The
GitHub workflow only builds and seals dependency-free `0.0.0-bootstrap.0` placeholders. It
has read-only permissions, receives no npm credential, cannot publish, and cannot enable the
autonomous release gate.

The placeholders use the `bootstrap` dist-tag, never `latest`. They exist only so an npm
owner can configure trusted publishing before the first functional `0.3.0` release. They
throw a precise diagnostic if imported explicitly. Do not bootstrap the current workspace
packages as `0.2.0`: they consume new `@termwright/protocol` subpaths that the published
protocol `0.2.0` does not provide, so those archives would install but fail at runtime.

## Retire the superseded package first

The bootstrap workflow verifies the complete npm namespace policy in its first job. Before
dispatching it, an npm owner with 2FA must deprecate the retired package with the exact
reviewed message:

```sh
npm deprecate '@termwright/ink-testing@*' 'Package retired; use @termwright/ink instead.'
npm view '@termwright/ink-testing@0.2.0' deprecated --json
```

The second command must return the exact message. Do not unpublish the package and do not add
a compatibility package to the workspace. Without this registry-side prerequisite the
artifact workflow fails closed before it builds anything.

## Build the reviewed artifact

1. Merge the reviewed bootstrap workflow into `main` after its normal CI succeeds.
2. Dispatch **npm bootstrap artifacts** once with the exact current 40-character `main`
   SHA. Do not rerun a failed attempt; diagnose it and start a new run.
3. Require the authorization and seal jobs to succeed on that same SHA. Native artifacts
   are deliberately absent: the normal `0.3.0` release workflow builds and certifies all six
   native packages.
4. Download `npm-bootstrap-artifacts-<sha>`. Keep the GitHub run URL with the artifact.

Before authenticating to npm, verify from the downloaded directory:

```sh
REVIEWED_SHA='<reviewed-40-character-main-sha>'
git -C /path/to/termwright checkout --detach "$REVIEWED_SHA"
test "$(git -C /path/to/termwright rev-parse HEAD)" = "$REVIEWED_SHA"
sha256sum --check SHA256SUMS
node /path/to/termwright/scripts/verify-npm-bootstrap-artifacts.mjs . --expected-sha "$REVIEWED_SHA"
```

On macOS, where `sha256sum` is not installed by default, use
`shasum -a 256 -c SHA256SUMS` for the first command.

`REVIEWED_SHA` is the exact SHA reviewed before workflow dispatch, not a value copied from
the downloaded artifact. The verifier checkout and manifest must both match it.
The verifier must report exactly eleven archives. The manifest must declare schema 2,
`registry-bootstrap-placeholders-v1`, version `0.0.0-bootstrap.0`, tag `bootstrap`, and the
reviewed workflow SHA. Every archive must be dependency-free and contain only the reviewed
placeholder files. Abort if npm already contains any name in the plan, the checksums do not
match, or the artifact inventory differs from `bootstrap-manifest.json`.

## Owner-only publication checklist

Use an npm owner account with 2FA from a clean machine. Do not put an npm token in GitHub,
the repository, a shell script, or the artifact. Inspect `bootstrap-manifest.json` and
publish each archive manually with scripts disabled. Both the archive and command pin the
non-default tag:

```sh
npm publish --access public --tag bootstrap --workspaces=false --ignore-scripts ./npm/<archive>.tgz
```

Follow `publicationOrder` exactly. After every publish, deprecate that exact administrative
version and verify the version, message, and tags:

```sh
npm deprecate '<name>@0.0.0-bootstrap.0' 'Registry bootstrap placeholder; install version 0.3.0 or newer.'
npm view '<name>@0.0.0-bootstrap.0' version --json
npm view '<name>@0.0.0-bootstrap.0' deprecated --json
npm view '<name>' dist-tags --json
node /path/to/termwright/scripts/verify-published-artifact.mjs npm ./npm/<archive>.tgz
```

The version and deprecation message must be exact. The tags must contain
`"bootstrap": "0.0.0-bootstrap.0"` and must not contain `latest`. The immutable artifact
comparison is mandatory after every publication, not only after an ambiguous response.
Continue only after it reports `exact`; `missing` means that archive still needs publishing.
Do not continue after an ambiguous response or a checksum/inventory discrepancy. If
publication stops after some packages, retain and resume from the same sealed artifact; do
not regenerate it after the registry scope has changed.

For each newly created package, configure npm trusted publishing for:

- repository: `Gorce-AI/termwright`
- workflow: `release.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

The retired `@termwright/ink-testing` name must remain in registry history with the exact
deprecation applied before this workflow was dispatched. The readiness gate inventories the
complete npm organization and fails if an undeclared package appears or any retired version
lacks that message.

Finally, run `pnpm check:npm-release-readiness` from the same reviewed commit. It must say
that every public workspace package exists and the namespace retirement policy is exact.
Trusted-publisher configuration is registry state and must be reviewed separately before
anyone authorizes the normal release gate. The normal release must publish the complete
functional `0.3.0` packages under `latest`; never promote the placeholder tag.
