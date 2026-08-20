# `@termwright/probe-go`

Shared build-time machinery for Termwright's Go framework probes. It provides
ephemeral workspace generation, a checksummed copy cache, reproducible upstream
patch application and provenance records.

This is internal plumbing used by `@termwright/probe-tview` and
`@termwright/probe-charm`; application authors normally install one of those
framework-specific packages instead.

```sh
pnpm add -D @termwright/probe-tview
# or
pnpm add -D @termwright/probe-charm
```

The package is ESM-only and requires Node.js 22 or newer.
