---
title: Running tests
description: Run the full suite, a directory, a file, or one case with Vitest or the Termwright Runner.
---

Use Vitest for repeatable command-line and CI runs. Use `termwright ui` when you
want to select tests visually, follow live terminals, or inspect retained
evidence.

## Run the full suite

```sh
npx vitest run
```

During local development, omit `run` to keep Vitest watching for changes:

```sh
npx vitest
```

## Run a file or test name

Vitest owns normal test selection:

```sh
npx vitest run tests/permission.test.ts
npx vitest run tests/permission.test.ts -t "rejects the command"
```

Physical Gherkin scenarios use the same scheduler after you add the
[`gherkinPlugin`](../guides/gherkin/#run-with-vitest-and-an-ide). A `.feature` file,
Scenario, or Scenario Outline row can therefore be selected like another
Vitest case.

## Run tests in the desktop Runner

```sh
npx termwright ui
```

The desktop app is the default interactive host. Its Specs catalog can run the
complete catalog, a directory, a file, or one case. Runner shows only the tests
in the requested run scope; it does not fill a file-only run with unrelated
catalog entries.

Use the browser host only when you specifically need it:

```sh
npx termwright ui --browser
```

Pass Vitest filters after `--` to constrain the catalog before the UI opens:

```sh
npx termwright ui -- tests/permission.test.ts -t "rejects"
```

## Rerun tests

In Runner, rerun a completed case from its execution row. Return to Specs to run
its file or directory again. While a run is active, overlapping Run controls
are disabled and Stop is available.

Vitest watch mode reruns affected tests after source changes. Press `r` in its
terminal to rerun the current selection.

## Retry failed tests

Vitest schedules retries. This example allows two additional attempts:

```sh
npx vitest run --retry=2
```

For CI defaults, use `termwrightRetry({ci: 2, local: 0})`. Reports and Runner
keep the ordered attempt failures and mark a case flaky when a later attempt
passes. See [Waiting and retries](../concepts/waiting-retries/) and
[CI and retries](../guides/ci/).

## Choose a command

| Task | Command |
| --- | --- |
| Repeatable local or CI run | `vitest run` |
| Watch source changes | `vitest` |
| Visual selection and debugging | `termwright ui` |
| Open a retained trace | `termwright ui --trace path/to/run.twtrace` |

See [Runner UI](../tools/runner-ui/) for the visual workflow and
[CLI and exit codes](../reference/cli/) for the complete command reference.
