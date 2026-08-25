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

## Runner at a glance

[![The full Runner test catalog with navigation, test hierarchy, status summary, and run controls.](/termwright/images/runner/spec-catalog.png)](/termwright/images/runner/spec-catalog.png)

- **Specs** selects a directory, file, or case to run.
- **Runner** follows live executions and replays retained evidence.
- **Runs** opens dated reports from earlier runs.
- **Settings** changes workspace layout and behavior.

## Run tests

The catalog groups tests by directory and file. Run a directory, a file, one
test, or the complete visible catalog. Expanding a group does not run it.
Termwright preserves the selected scope in Runner: tests outside it are not
shown as members of that run.

The status counters beside the execution list show passed, failed, skipped,
running, and waiting tests. A mixed pass/skip run is amber
`passed-with-skips`, not an ordinary green pass, and Runner explains that the
skip policy remains part of certification. During a run, overlapping Run
controls are disabled and Stop becomes available.

## Follow an active run

[![An active run with a blue running test, its current step, and live terminal output.](/termwright/images/runner/active-run.png)](/termwright/images/runner/active-run.png)

Runner can show several concurrently executing tests. Select a test in the
execution list to switch its terminal and inspector evidence. A running test is
blue; green is reserved for a completed pass.

The Native Host journal is armed before workers and PTYs start. Run, Attempt,
Session, Step, and Action events carry collision-safe identities plus a
producer epoch and sequence. User stdout and stderr are structured diagnostic
events attributed to the exact Attempt; the UI never parses reporter text to
reconstruct lifecycle. A bounded diagnostic loss is rendered as an explicit
gap, never as an apparently complete timeline.

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

For a live semantic node, **Semantic** also asks the worker's production
`ActionPlanner` four questions: **Can click?**, **Can hover?**, **Can focus?**,
and **Can type?**. Each answer carries the exact committed contract/revision,
strategy, requirements and evidence provider used by the corresponding
Locator action. Runner rejects a batch spanning different checkpoints; it does
not reconstruct actionability from node fields in the browser.

The Effective Session Contract card shows the certified adapter ID,
application providers, terminal mouse observability, authoritative capability
provenance, and the resulting contract-level input API. Current mouse mode,
coverage, disabled state and occlusion remain runtime actionability results,
not capability labels.

Selecting a node highlights it only when the trace contains exact geometry for
that recorded state. Runner does not infer a rectangle from rendered text or
paint order.

## Open a historical run

[![Run history with dated test runs, status summaries, and replay actions.](/termwright/images/runner/run-history.png)](/termwright/images/runner/run-history.png)

Runs lists retained reports with their date and time. Open a report to inspect
its tests, attempts, canonical verdict, passed/failed/skipped counts, flaky
result, earlier failure reasons, duration, and trace availability. Historical
replays are contextual to each window or tab; opening a newer run does not
replace an already pinned replay elsewhere.

Only a staged, validated and atomically committed run directory is certified
complete. Runner also lists incomplete, corrupt, and unsupported-version
records explicitly so a persistence or host crash cannot look like an empty or
successful run.

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

[![Runner Settings with workspace, replay, accessibility, editor, and reset controls.](/termwright/images/runner/settings.png)](/termwright/images/runner/settings.png)

Settings controls layout, timeline behavior, replay speed, reduced motion, and
the source editor. **Reset layout** preserves unrelated preferences; **Reset
all** restores every UI preference. Copied diagnostics omit authentication,
terminal output, raw semantic data, and generated source.

See [Runner accessibility](../accessibility/) for keyboard, focus, and reduced
motion behavior.
