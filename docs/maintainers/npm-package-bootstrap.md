# One-time npm package bootstrap

This procedure creates the eleven package names that predate npm trusted publishing. The
GitHub workflow only builds and seals tarballs. It has read-only permissions, receives no
npm credential, cannot publish, and cannot enable the autonomous release gate.

## Build the reviewed artifact

1. Merge the reviewed bootstrap workflow into `main` after its normal CI succeeds.
2. Dispatch **npm bootstrap artifacts** once with the exact current 40-character `main`
   SHA. Do not rerun a failed attempt; diagnose it and start a new run.
3. Require all six native matrix jobs, the native Windows x64-on-ARM64 certification, and
   the seal job to succeed on that same SHA.
4. Download `npm-bootstrap-artifacts-<sha>`. Keep the GitHub run URL with the artifact.

Before authenticating to npm, verify from the downloaded directory:

```sh
sha256sum --check SHA256SUMS
node /path/to/termwright/scripts/verify-npm-bootstrap-artifacts.mjs .
```

The verifier must come from a checkout at the manifest's exact `sourceCommit`.
The verifier must report exactly eleven archives and the manifest's `sourceCommit` must be
the reviewed workflow SHA. Abort if npm already contains any name in the plan, the checksums
do not match, or the artifact inventory differs from `bootstrap-manifest.json`.

## Owner-only publication checklist

Use an npm owner account with 2FA from a clean machine. Do not put an npm token in GitHub,
the repository, a shell script, or the artifact. Inspect `bootstrap-manifest.json` and
publish each archive manually with scripts disabled:

```sh
npm publish --access public --tag latest --workspaces=false --ignore-scripts npm/<archive>.tgz
```

Follow `publicationOrder` exactly. It puts all six native platform packages first, then
the four independent TypeScript packages, and `@termwright/pty` last. After every command,
confirm that the exact `name@version` is visible with `npm view`; do not continue after an
ambiguous response or a checksum/inventory discrepancy.

For each newly created package, configure npm trusted publishing for:

- repository: `Gorce-AI/termwright`
- workflow: `release.yml`
- environment: `npm-publish`

The old `@termwright/ink-testing` package was retired when component testing moved into
`@termwright/ink`. Keep the name as explicit registry history, but deprecate every published
version with the exact reviewed message:

```sh
npm deprecate '@termwright/ink-testing@*' 'Package retired; use @termwright/ink instead.'
npm view '@termwright/ink-testing@0.2.0' deprecated --json
```

Do not unpublish it and do not add a compatibility package to the workspace. The readiness
gate inventories the complete npm organization and fails if an undeclared package appears or
any retired version lacks its exact deprecation message.

Finally, run `pnpm check:npm-release-readiness` from the same reviewed commit. It must say
that every public workspace package exists and the namespace retirement policy is exact.
Trusted-publisher configuration is registry state and must be reviewed separately before
anyone authorizes the normal release gate.
