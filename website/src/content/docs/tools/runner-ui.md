---
title: Runner UI
description: Run tests, inspect terminal evidence, replay traces, and record a test in the Termwright desktop app.
---

Runner UI is the interactive view of your Termwright suite. Use it while writing
tests and investigating failures. `termwright ui` opens the Termwright desktop
app by default and keeps Vitest in watch mode.

```sh
npx termwright ui
```

Use `--browser` when you want the same UI in your system browser. Use
`--no-open` for a server-only process.

## Run a test scope

[![The test catalog with directory, file, and individual test Run controls.](/termwright/images/runner/spec-catalog.png)](/termwright/images/runner/spec-catalog.png)

The catalog groups tests by directory and file. Run a directory, a file, one
test, or the complete visible catalog. Expanding a group does not run it.
Termwright preserves the selected scope in Runner: tests outside it are not
shown as members of that run.

The status counters beside the execution list show passed, failed, running,
and waiting tests. During a run, overlapping Run controls are disabled and Stop
becomes available.

## Follow an active run

[![An active run with a blue running test, its current step, and live terminal output.](/termwright/images/runner/active-run.png)](/termwright/images/runner/active-run.png)

Runner can show several concurrently executing tests. Select a test in the
execution list to switch its terminal and inspector evidence. A running test is
blue; green is reserved for a completed pass.

The execution list groups driver actions and assertions beneath their authored
test or Gherkin step. Hover or select a row with a retained semantic target to
highlight the corresponding terminal cells.

## Replay a completed test

[![A completed test with its retained terminal recording and replay controls visible at the bottom.](/termwright/images/runner/replay-player.png)](/termwright/images/runner/replay-player.png)

A completed test with a retained trace opens in replay mode. The controls below
the terminal seek, play, change playback speed, and jump to recorded markers.
Pressing Play at the end starts again from the beginning.

The terminal, execution list, semantic inspector, and logs all follow the same
playhead. Logs from later in the recording are not shown while you inspect an
earlier moment.

## Inspect a failure

[![A failed test with the failing assertion, error details, and replay evidence visible together.](/termwright/images/runner/failure-inspection.png)](/termwright/images/runner/failure-inspection.png)

Open the failed test and start with the first failing execution row. Runner
keeps the error, source location, earlier retry failures, terminal recording,
crash details, and lost-log warning with the same test attempt.

If the trace artifact no longer exists, Runs disables Replay and explains why.
For symptom-based help, see [Debug a failing test](../debugging/).

## Inspect semantic state

[![The semantic inspector showing a dialog and its button and textbox children.](/termwright/images/runner/semantics-inspector.png)](/termwright/images/runner/semantics-inspector.png)

The inspector has three views:

- **Tree** presents roles, accessible names, state, and hierarchy.
- **Semantic** presents readable properties for the selected node.
- **Logs** presents application logs up to the current replay time.

Selecting a node highlights it only when the recording contains qualified
geometry for that exact semantic revision. Runner does not infer a rectangle
from text or paint order.

## Open a historical run

[![Run history with dated test runs, status summaries, and replay actions.](/termwright/images/runner/run-history.png)](/termwright/images/runner/run-history.png)

Runs lists retained reports with their date and time. Open a report to inspect
its tests, attempts, flaky result, earlier failure reasons, duration, and trace
availability. Historical replays are contextual to each window or tab; opening
a newer run does not replace an already pinned replay elsewhere.

## Record a test

[![Recorder launch dialog with command and save destination fields.](/termwright/images/runner/recorder.png)](/termwright/images/runner/recorder.png)

Choose **New test → Record test**, or start directly:

```sh
npx termwright ui --record --out-file tests/permission.test.ts -- node app.js
```

Drive the real terminal, add named steps, capture semantic actions and
assertions, then stop recording. Review and edit the generated source before
you save it. Discard exits without writing the file.

See [Record a test](../recorder/) for the complete workflow and its limits.

## Open an existing trace

```sh
npx termwright ui --trace .termwright/traces/permission.twtrace
```

This opens post-mortem mode without starting the test suite. A standalone HTML
report uses the same React viewer with live-only controls removed.

## Change workspace preferences

Settings controls navigation width, timeline density and following, default
inspector state, replay speed, reduced motion, source editor, and saved layout.
Reset layout leaves unrelated preferences intact; Reset all restores every UI
preference. Diagnostics copied from Settings omit authentication values,
terminal output, raw semantic data, and generated source.

## Regenerate these screenshots

The screenshots on this page come from the current built Runner and
deterministic fixtures:

```sh
pnpm docs:screenshots
```

See the repository [Documentation Guide](https://github.com/gorce-ai/termwright/blob/main/docs/DOCUMENTATION_GUIDE.md)
for the screenshot review and update policy.
