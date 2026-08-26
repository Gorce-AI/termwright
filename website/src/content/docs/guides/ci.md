---
title: Run tests in CI
description: Certify a Termwright run with explicit resources, zero hidden retries, and transactional evidence.
---

Termwright runs on macOS >= 13.5, Windows 10 version 1809 / Server 2019 or newer, and
glibc-based Linux at the Ubuntu 22.04 ABI floor (glibc >= 2.35). Use Node.js 22 or
newer. Alpine/musl is not supported by the prebuilt PTY dependency.

## GitHub Actions

```yaml
name: test

on:
  push:
  pull_request:

env:
  TERMWRIGHT_RETRIES: '0'
  TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1'
  TERMWRIGHT_UPDATE_SNAPSHOTS: 'none'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Reject workflow reruns
        shell: bash
        run: test "$GITHUB_RUN_ATTEMPT" = 1
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.4.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npx termwright doctor --json
      - run: npx termwright test --resource-profile ci
        env:
          CI: 'true'
      - uses: actions/upload-artifact@v4
        if: failure() || cancelled()
        with:
          name: termwright-runs
          path: .termwright/runs/
          include-hidden-files: true
```

The native host records the resolved resource profile, exact Vitest/Node
runtime, RunId, AttemptIds, Git/CI provenance and authoritative journal in each
committed run. `ci` is an explicit bounded PTY/process envelope; it is not a
package-wide serialization switch.

## Retries do not certify determinism

```sh
# Optional diagnostic experiment; a fail-then-pass run is still flaky/nonzero.
npx termwright test --resource-profile ci -- --retry=2
```

Every retry gets a distinct AttemptId and evidence. Certification lanes use
zero retries. If a diagnostic retry passes after an earlier failure, the host
classifies the run as `flaky` and exits non-zero; a later pass never erases the
reliability defect. GitHub Actions has no native yellow success state, so this
is intentionally a red check with an amber/flaky classification in Termwright's
report and UI.

A mixed pass/skip result is amber `passed-with-skips`. It may exit zero only
when every skip is covered by the exact reviewed applicability policy; a
missing, ambiguous, or stale required declaration is red. An all-skipped or
empty lane is always red. This keeps legitimate platform applicability visible
without letting a missing toolchain or silently skipped suite look green.

For a determinism lane, repeat full lifecycle cycles inside one host rather
than wrapping the command in a shell loop:

```sh
TERMWRIGHT_RETRIES=0 npx termwright test --runs 50 --resource-profile ci
```

Termwright's own certification also has separate bounded lanes for
multi-terminal pressure, deterministic acquisition/cleanup faults, seeded
shuffle (the seed is written to the job summary), resource-leak barriers,
Windows ConPTY lifecycle stress, and a scheduled Node 22/24 soak on all three
supported operating systems.

## Choose a trace policy

The default `retain-on-failure` policy keeps evidence for failures without
retaining every successful run. Use `trace: 'on'` when successful CI runs are
also useful for auditing. Use `trace: 'off'` only when no replay evidence is
needed.

## Keep the environment deterministic

- Pin the Node and package-manager versions.
- Use a Debian/Ubuntu-based container rather than Alpine.
- Set a terminal profile and palette when color or width is asserted.
- Declare input files through the fixture instead of relying on a repository
  working directory.
- Upload `.termwright/runs/` when the job fails or is cancelled so retained
  failure and incomplete-infrastructure evidence is available without creating
  an artifact for every green matrix row. GitHub's artifact action ignores
  dot-directories unless `include-hidden-files: true` is set.

See [Configuration](../../reference/configuration/) for profiles and
[Traces and reports](../../tools/traces-reports/) for artifact formats.
