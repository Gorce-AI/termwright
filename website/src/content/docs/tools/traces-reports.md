---
title: Traces and reports
description: Retain terminal recordings, replay a run, create a self-contained report, and capture a recorded frame.
---

Traces retain the terminal recording, semantic revisions, test steps, actions,
assertions, application logs, and crash metadata for one or more sessions.

Trace publication is transactional. Termwright writes and fsyncs a staging
directory, records checksums in `COMMITTED`, and only then atomically publishes
the `.twtrace` directory. The Runner distinguishes complete, incomplete,
corrupt, and unsupported-version artifacts instead of attempting a best-effort
replay. Packaging likewise refuses an uncommitted trace.

## Choose a trace policy

```ts
configureTermwright({
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
});
```

| Policy              | Use when                                               |
| ------------------- | ------------------------------------------------------ |
| `retain-on-failure` | Normal local and CI runs. This is the default.         |
| `on-first-retry`    | Large suites where only the first retry needs a trace. |
| `on`                | Successful runs must also remain replayable.           |
| `off`               | Recording is not permitted or needed.                  |

Driver actions and matcher assertions are recorded automatically. Named
`step()` blocks organize those events. Do not call a second recording API after
a normal Termwright action.

## Replay a trace

```sh
termwright ui --trace termwright-report/traces/example.twtrace
```

The Runner opens the retained terminal and evidence. The player seeks across
terminal frames while steps, crash markers, semantic state, and logs follow the
same playhead.

## Generate an HTML report

Run tests with `termwright test`; the Native Host owns trace retention and the
transactional run record. Direct `vitest run` is not a Termwright execution
mode. A generated report is a self-contained HTML file. It uses the same React
viewer as the Runner but does not expose live-run, history, or file-system
actions.

[![A self-contained HTML report showing retained terminal replay and failure evidence.](/termwright/images/runner/html-report.png)](/termwright/images/runner/html-report.png)

Generate a report for one existing archive:

```sh
termwright report --trace path/to/run.twtrace --out-file report.html
```

## Capture a PNG

```sh
termwright screenshot --trace path/to/run.twtrace --at 1200 --out-file state.png
termwright screenshot --trace path/to/run.twtrace --step 3 --scale 2
```

Without `--at` or `--step`, the command chooses the crash or the end of the last
step. This avoids capturing an empty final screen after an alternate-screen
application exits.

## Inspect retries and flaky cases

The manifest and report keep ordered attempts. A case that passes after an
earlier failure is classified as flaky, and the earlier reasons remain visible.
See [Run tests in CI](../../guides/ci/) for retry configuration.

## Share artifacts safely

Traces and reports may contain terminal output, semantic names and values,
application logs, commands, file paths, and error stacks. Treat them as test
artifacts and apply the same retention and access policy as CI logs.

The Runner authentication token is not stored in a trace or report.
