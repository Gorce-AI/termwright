---
title: Run tests in CI
description: Run Termwright without retries and upload traces and run history when a job fails.
---

Run the same `termwright test` command in CI, with a CI resource profile and no
retries. Preserve both the run history and trace output when the job fails.

## GitHub Actions

This example uses npm and Linux. Replace `npm ci` with your package manager's
frozen-lockfile install when needed.

```yaml
name: terminal-tests

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      CI: 'true'
      TERMWRIGHT_RETRIES: '0'
      TERMWRIGHT_UPDATE_SNAPSHOTS: 'none'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx termwright doctor --json
      - run: npx termwright test --resource-profile ci
      - uses: actions/upload-artifact@v4
        if: failure() || cancelled()
        with:
          name: termwright-failure
          path: |
            .termwright/runs/
            termwright-report/
          include-hidden-files: true
```

`termwright-report/` contains retained traces.
`.termwright/runs/` contains the run and attempt history that refers to those
traces. Keep both if you want the downloaded artifact to appear in Runner's run
history.

## Supported CI environments

Use Node.js 22 or 24. Termwright's native PTY packages support:

- glibc 2.35+ Linux on x64 and arm64;
- macOS 13.5+ on x64 and arm64;
- Windows 10 1809+ or Server 2019+ on x64 and arm64.

Alpine/musl images are not supported. For container jobs, use a Debian- or
Ubuntu-based Node image such as `node:22-slim`.

Use `--resource-profile windows-ci` on Windows. Use an operating-system matrix
when the application itself supports multiple operating systems; a terminal
profile cannot reproduce platform-specific process and PTY behavior.

## Keep retries disabled

An ordinary CI job should use zero retries. A later passing attempt does not
erase an earlier failure: Termwright reports the run as flaky and returns a
non-zero exit code.

You can request retries in a separate diagnostic job:

```sh
npx termwright test --resource-profile ci -- --retry=2
```

This runs up to three attempts and retains each failed attempt for inspection.

## Keep the run reproducible

- Pin the Node and package-manager versions.
- Install from the lockfile.
- Declare test files through `terminal.launch({ files })` instead of relying on
  files left by an earlier test.
- Set terminal columns, rows, and profile when layout or character width is part
  of an assertion.
- Pass required environment variables explicitly.
- Keep snapshot updates disabled in the test job.

## Use a terminal matrix

Named Termwright profiles can run the same tests with different viewport or
character-width settings. Operating-system jobs should remain a CI matrix.

```sh
npx termwright test -- --project compact
```

See [Configuration](../../reference/configuration/#configure-a-terminal-matrix)
for profile setup.

## Open a failure from CI

Download the artifact, then open a retained trace directly:

```sh
npx termwright ui --trace termwright-report/traces/example.twtrace
```

Or copy both downloaded directories into the project and open **Runs** in
`termwright ui`.

## Next steps

- [Open traces and reports](../../tools/traces-reports/)
- [Protect secrets](../../reference/security/)
- [Supported platforms and limitations](../../reference/limitations/)
