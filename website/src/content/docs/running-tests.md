---
title: Running tests
description: Run, watch, select, and diagnose tests through the certified Termwright host.
---

`termwright test`, `termwright watch`, and `termwright ui` are three surfaces of
the same certified native host. Vitest remains the embedded engine for
collection, Vite transforms, mocks, assertions and its familiar test DSL;
Termwright owns terminal resources, run/attempt identity, event integrity and
cleanup. Direct `vitest` execution is not a certified Termwright product mode.

## Run the full suite

```sh
npx termwright test
```

To certify scheduler-independent behavior repeatedly without spawning sibling
Vitest processes, keep one native host alive for several complete cycles:

```sh
TERMWRIGHT_RETRIES=0 npx termwright test --runs 50 --resource-profile ci
```

Every cycle receives a new RunId and must independently pass its journal,
resource, cleanup and transactional-history barriers. The command returns the
worst cycle result and stops early only if the persistent host loses
certification through an infrastructure failure. An empty or entirely skipped
run is recorded as `skipped`, but `termwright test` exits non-zero because it is
not evidence of a passing suite.

A mixed pass/skip run is recorded as `passed-with-skips` and shown in amber,
never as an ordinary green pass. It exits zero only when every skipped native
case matches exactly one repository-owned declaration and every selected
required declaration was observed. An undeclared, ambiguous, or unexpectedly
unskipped required case exits non-zero. Repository-wide platform declarations
live in `quality/platform-deviations.json`; a project may declare other exact
applicability rules in `quality/applicability-skips.json`:

```json
{
  "version": 1,
  "rules": [
    {
      "id": "windows-only-terminal-case",
      "file": "tests/windows.test.ts",
      "fullName": "uses native ConPTY",
      "platforms": ["linux", "darwin"],
      "required": true
    }
  ]
}
```

`file` plus `fullName` names one exact native leaf case. A suite title does not
cover its descendants; declare each intentionally skipped case separately. If
the same leaf occurs more than once in a file, add `suite` with its exact
top-level suite name. Termwright ignores only the generated trailing
`(skipped: …)` reason when comparing that scope; it never treats the scope as a
prefix or subtree wildcard.
`required: true` means the case must be observed as skipped whenever it is
selected on an applicable platform. Omit it for an allowed skip that need not
occur on every run. Skips remain visible in human output and in the `runs[].skips`
and `runs[].skipPolicy` fields of `--json` output.

During local development, keep the same host alive across source changes:

```sh
npx termwright watch
```

## Run a file or test name

Pass engine-native filters after `--`; selection is resolved to native collected
test IDs before execution:

```sh
npx termwright test -- tests/permission.test.ts
npx termwright test -- tests/permission.test.ts -t "rejects the command"
```

Physical Gherkin scenarios are transformed into cases in this same host. There
is no second Gherkin scheduler.

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

`termwright watch` coalesces source changes while a run is active and starts a
new collision-safe RunId in the same persistent engine after it finishes.

## Retry failed tests

The embedded engine can schedule diagnostic retries:

```sh
npx termwright test -- --retry=2
```

Every try receives a unique AttemptId and its own diagnostics. A later green
attempt does not certify the run: the host returns `flaky` and exits non-zero.
Retries are evidence for debugging, not a substitute for determinism. See
[Waiting and retries](../concepts/waiting-retries/) and [CI and retries](../guides/ci/).

## Run a terminal matrix

Configure named Termwright profiles as Vitest projects when layout or character
width must work in more than one terminal configuration:

```sh
npx termwright test
npx termwright test -- --project compact
```

The first command runs every configured project. The second selects one. See
[Test matrices](../reference/configuration/#test-matrices) for configuration;
use the CI operating-system matrix for platform coverage.

## Choose a command

| Task | Command |
| --- | --- |
| Repeatable local or CI run | `termwright test` |
| Determinism certification in one host | `termwright test --runs 50` |
| Watch source changes | `termwright watch` |
| Visual selection and debugging | `termwright ui` |
| Open a retained trace | `termwright ui --trace path/to/run.twtrace` |

See [Runner UI](../tools/runner-ui/) for the visual workflow and
[CLI and exit codes](../reference/cli/) for the complete command reference.
