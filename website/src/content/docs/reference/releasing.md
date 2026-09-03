---
title: Releases and versioning
pagefind: false
description: How Termwright versions packages, publishes registries, and keeps the protocol aligned across languages.
---

This page describes the release contract for people who consume Termwright. The
maintainer runbook lives in
[`RELEASING.md`](https://github.com/gorce-ai/termwright/blob/main/RELEASING.md)
in the repository.

## Release approval

A normal merge to `main` does not publish a package. The trusted release
coordinator detects pending changesets on the exact `main` commit and opens or
updates a generated Version PR. It independently reproduces that PR from the
trusted base, runs the complete certification DAG, and merges only the exact
certified head. The coordinator then publishes crates.io, PyPI, npm and the
GitHub Release from that merged commit. A failed or rerun workflow attempt is
not accepted as release evidence.

The unattended path is also protected by the fail-closed repository variable
`TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED`. Only the exact value `true` lets
automation prepare, merge, or publish a Version PR. If the variable is absent
or disabled, framework certification, compatibility allowlist merges, and
issue closure continue normally, while pending changesets remain queued. A
manually started compatibility run never initiates a release.

A version that exists was therefore proposed with explicit version and
changelog changes, deterministically reproduced, and tested before publication.

All three registries authenticate through OIDC trusted publishing — no
long-lived registry tokens exist in the repository — and npm packages carry
[provenance](https://docs.npmjs.com/generating-provenance-statements), so you
can verify which commit and workflow produced a tarball.

## What a version number means

**The npm packages move together.** `@termwright/driver`, `@termwright/test`,
the framework integrations and annotation SDKs, `@termwright/mcp`,
`@termwright/ui` and the `termwright` umbrella share a version and are released
as one. This keeps installation and compatibility predictable.

**The protocol version is a compatibility promise across languages.** These six
always carry the same number:

| Package                                     | Registry   |
| ------------------------------------------- | ---------- |
| `@termwright/protocol`                      | npm        |
| `termwright`                                | PyPI       |
| `termwright-protocol`                       | crates.io  |
| `termwright-probe-ratatui`                  | crates.io  |
| `termwright-ratatui`                        | crates.io  |
| `github.com/gorce-ai/termwright/clients/go` | Go modules |

If your Python producer and your TypeScript driver report the same version, they
speak the same wire format. That is checked in CI on every pull request, not
just at release time.

## Preview packages

| Channel              | What it is                                                                 | How to install                                             |
| -------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| PR preview           | A build of an open pull request, on pkg-pr-new. Never touches npm.         | `npm i https://pkg.pr.new/@termwright/driver@<pr>`         |
| PR preview artifacts | A checksummed GitHub artifact containing all locally installable tarballs. | Download, verify, and install the current-platform subset. |

PR previews are opt-in per pull request. They provide installable artifacts for
review without consuming a package version or changing an npm dist-tag. A repository
owner must install the `pkg-pr-new` GitHub App before adding the `pr preview` label; the
label deliberately means that the external publishing prerequisite is ready.

Use the `pr preview artifacts` label when the GitHub App is unavailable or a review needs
the exact downloadable package set. The artifact name includes the synthetic merge commit;
`build-identity.json` also records the PR head and base commits, while `SHA256SUMS` seals the
metadata and every tarball. This channel never claims a pkg-pr-new URL and never touches npm.
After downloading, verify `sha256sum --check SHA256SUMS`, then install only the dependency
closure for the platform under test. For example, on Linux x64:

```sh
npm install \
  npm/termwright-protocol-*.tgz \
  npm/termwright-vt-*.tgz \
  npm/termwright-pty-linux-x64-*.tgz \
  npm/termwright-pty-[0-9]*.tgz \
  npm/termwright-driver-*.tgz
```

Do not install native prebuild tarballs for other operating systems or architectures.

## Older lines

Maintenance branches (`release/N.x`) are created when a backport is actually
needed rather than in advance. Releases from them publish under a dedicated
dist-tag such as `0.x-lts`, so `latest` always points at the current line.

## Release notes

One GitHub Release per coordinated version, on the `protocol/vX.Y.Z` tag, with
the changelogs of every package that moved. It is published only after all three
registries confirm they have the version — release notes that announce something
you cannot install are worse than no notes.

If a release is ever published while a registry is still catching up, the notes
say so explicitly, listing what is missing.
