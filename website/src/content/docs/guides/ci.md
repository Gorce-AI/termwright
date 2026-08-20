---
title: Run tests in CI
description: Run Termwright on CI, retain reports and traces, and retry failed cases with Vitest.
---

Termwright runs on macOS, Windows, and glibc-based Linux. Use Node.js 22 or
newer. Alpine/musl is not supported by the prebuilt PTY dependency.

## GitHub Actions

```yaml
name: test

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.4.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
        env:
          CI: 'true'
          TERMWRIGHT_RETRIES: '2'
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: termwright-report
          path: termwright-report/
```

`TERMWRIGHT_RETRIES=2` means two additional attempts, for at most three
attempts total. Vitest remains the retry scheduler.

## Configure retries and reports

```ts
// vitest.config.ts
import {defineConfig} from 'vitest/config';
import {termwrightRetry} from 'termwright/test';
import TermwrightReporter from 'termwright/reporter';

export default defineConfig({
  test: {
    retry: termwrightRetry({ci: 2, local: 0}),
    reporters: ['default', new TermwrightReporter()],
  },
});
```

The report keeps earlier attempt failures with the final outcome. A case that
passes after a failed attempt is marked flaky.

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
- Upload `termwright-report/` with `if: always()` so failed jobs retain it.

See [Configuration](../../reference/configuration/) for profiles and
[Traces and reports](../../tools/traces-reports/) for artifact formats.
