---
title: Run tests
description: Run a suite, select a file or test, use watch mode, and open the Runner.
---

Use `termwright test` for a single local or CI run:

```sh
npx termwright test
```

Termwright finds the project's test files, runs them, and prints the result. It
returns zero only when the selected suite finishes with an accepted passing
result; flaky, empty, all-skipped, failed, and infrastructure-error runs return
non-zero.

## Run one file or test

Pass test filters after `--`:

```sh
npx termwright test -- tests/permission.test.ts
npx termwright test -- tests/permission.test.ts -t "rejects the command"
```

The first command runs one file. The second also filters by the test's name.

## Rerun after source changes

```sh
npx termwright watch
```

Watch mode keeps the test process open and starts a new run after relevant files
change. It waits for an active run to finish before starting the next one.

## Use the Runner

```sh
npx termwright ui
```

The desktop Runner lists the collected tests and can run the whole project, a
directory, a file, or one test. During a run it shows the live terminal and the
current test step. Select a failed attempt to replay its trace. Runner watches
for source changes by default.

Use the browser version or start a server without opening a window when needed:

```sh
npx termwright ui --browser
npx termwright ui --no-open
```

You can filter the initial catalog too:

```sh
npx termwright ui -- tests/permission.test.ts -t "rejects"
```

See [Use the Runner](../tools/runner-ui/) for the complete visual workflow.

## Run diagnostic retries

```sh
npx termwright test -- --retry=2
```

Termwright keeps each failed attempt. If a retry passes after an earlier
failure, the run is reported as flaky and still exits non-zero. Use retries to
collect evidence, not to make an unstable CI job green.

## Run in CI

Set `CI=true`, disable retries, and upload both `termwright-report/` and
`.termwright/runs/` when a test fails:

```sh
CI=true TERMWRIGHT_RETRIES=0 npx termwright test --resource-profile ci
```

The command above uses POSIX shell syntax. In CI configuration, prefer setting
the variables through the job's environment mapping. Use the `windows-ci`
resource profile for Windows jobs.

Use an operating-system matrix if the application supports more than one OS.
Termwright does not treat a terminal profile as a substitute for running on
Windows, macOS, or Linux.

Follow [Run tests in CI](../guides/ci/) for complete workflow examples and
artifact handling.

## Repeat a suite to reproduce a leak

If a lifecycle or resource leak appears only after repeated execution, keep one
Termwright process alive for several complete runs:

```sh
npx termwright test --runs 50
```

Use this for reproduction, not as the normal way to retry one failed test.

## Command summary

| Task                   | Command                                         |
| ---------------------- | ----------------------------------------------- |
| Run once               | `npx termwright test`                           |
| Run one file           | `npx termwright test -- path/to/file.test.ts`   |
| Filter by name         | `npx termwright test -- -t "name"`              |
| Rerun on changes       | `npx termwright watch`                          |
| Run and debug visually | `npx termwright ui`                             |
| Open a saved trace     | `npx termwright ui --trace path/to/run.twtrace` |
| Check the installation | `npx termwright doctor`                         |

See [CLI reference](../reference/cli/) for every option and exit code.
