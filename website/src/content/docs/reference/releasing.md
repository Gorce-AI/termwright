---
title: Releasing
description: How termwright versions and ships — manual pipelines, protocol lockstep, and what a version number promises you.
---

This page is for people who consume termwright releases. The operational
runbook — which workflow to dispatch, in what order, what to do when a registry
fails — lives in
[`RELEASING.md`](https://github.com/gorce-ai/termwright/blob/main/RELEASING.md)
in the repository.

## Nothing publishes automatically

Every stable release to npm, PyPI and crates.io is a workflow a maintainer
dispatches by hand from the coordinated protocol tag, behind an approval gate.
A merge to `main` ships nothing. Opt-in npm canaries are also manual and gated,
but build a separately named source ref through the trusted npm workflow.

Two consequences you can rely on: a version that exists was published on
purpose, and there is no path by which a merged pull request reaches your
`node_modules` without someone deciding it should.

All three registries authenticate through OIDC trusted publishing — no
long-lived registry tokens exist in the repository — and stable npm packages carry
[provenance](https://docs.npmjs.com/generating-provenance-statements), so you
can verify which tagged commit and workflow produced a tarball. Canary packages
do not claim provenance: their source ref can intentionally differ from the
trusted workflow ref, so attaching the workflow's identity to that source would
be misleading.

## What a version number means

**The npm packages move together.** `@termwright/driver`, `@termwright/test`,
the framework probes and annotation SDKs, `@termwright/mcp`, `@termwright/ui`
and the `termwright` umbrella share a version and are released as one. They are
one product; a matrix of independently drifting versions would be a support
burden for no benefit.

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

## Prereleases

| Channel | What it is | How to install |
|---|---|---|
| PR preview | A build of an open pull request, on pkg-pr-new. Never touches npm. | `npm i https://pkg.pr.new/@termwright/driver@<pr>` |
| Canary | A real npm publish under the `canary` dist-tag, cut from a branch on request. | `npm i @termwright/driver@canary` |

A canary never moves `latest`, so nothing you already installed can pick one up.
It is emitted by the same trusted npm workflow as stable releases because npm
allows one trusted publisher workflow per package; the source build remains
separate from the privileged publish job. PR previews are opt-in per pull
request — if you want one for a PR that has no build yet, ask on the PR.

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
