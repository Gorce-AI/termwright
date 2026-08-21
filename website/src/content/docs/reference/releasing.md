---
title: Releases and versioning
description: How Termwright versions packages, publishes registries, and keeps the protocol aligned across languages.
---

This page describes the release contract for people who consume Termwright. The
maintainer runbook lives in
[`RELEASING.md`](https://github.com/gorce-ai/termwright/blob/main/RELEASING.md)
in the repository.

## Release approval

A normal merge to `main` does not publish a package. A maintainer starts a
Release workflow, reviews the generated Version PR, and merges it after CI
passes. Merging that specific PR is the release approval: the workflow then
publishes crates.io, PyPI, npm and the GitHub Release from the reviewed commit.

A version that exists was therefore proposed with explicit version and
changelog changes, reviewed, and tested before publication.

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

| Package | Registry |
|---|---|
| `@termwright/protocol` | npm |
| `termwright` | PyPI |
| `termwright-protocol` | crates.io |
| `termwright-probe-ratatui` | crates.io |
| `termwright-ratatui` | crates.io |
| `github.com/gorce-ai/termwright/clients/go` | Go modules |

If your Python producer and your TypeScript driver report the same version, they
speak the same wire format. That is checked in CI on every pull request, not
just at release time.

## Preview packages

| Channel | What it is | How to install |
|---|---|---|
| PR preview | A build of an open pull request, on pkg-pr-new. Never touches npm. | `npm i https://pkg.pr.new/@termwright/driver@<pr>` |

PR previews are opt-in per pull request. They provide installable artifacts for
review without consuming a package version or changing an npm dist-tag.

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
