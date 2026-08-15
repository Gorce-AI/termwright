---
title: Traces, recordings and reports
description: What a .twtrace archive holds, how recording and trimming work, and what the HTML failure report shows.
---

Recording is **on by default**. A terminal session is cheap to record and
expensive to reproduce, so termwright records first and decides later whether to
keep the archive — trace collection defaults to `retain-on-failure`.

## The archive

A `.twtrace` is a directory (zippable for transport) holding four files:

| File | Content |
|---|---|
| `meta.json` | session id, command, viewport, platform, exit status |
| `session.cast` | asciicast **v3**; `test.step()` titles become markers |
| `events.jsonl` | inputs, resizes, steps, locator actions, assertions |
| `semantics.jsonl` | one semantic tree per revision, with its cast offset |

The layout is normative in
[`CONTRACTS.md`](https://github.com/gorce-ai/termwright/blob/main/CONTRACTS.md)
§Trace, and nothing outside `@termwright/trace` reads or writes those files
directly.

## Steps are the navigation

`test.step()` (or the `step` fixture) names a section of the test. That name
becomes a marker in the recording, a step in the trace and a section in the
report — which is what turns "the test failed somewhere" into "jump to the
moment it failed".

```ts
test('approves a command', async ({terminal, step}) => {
  const app = await terminal.launch({command: ['node', 'agent.js']});

  await step('wait for the prompt', async () => {
    await app.waitForText('Permission required');
  });

  await step('approve', async () => {
    await app.getByRole('button', {name: 'Approve'}).activate();
  });
});
```

Prefer the `step` fixture over `test.step()` under `test.concurrent`: it is
bound to its own test rather than to the most recently started one.

## Recording an ad-hoc session

Outside the preset the writer attaches to any harness:

```ts
import {createTraceWriter, openTrace, generateHtmlReport} from '@termwright/trace';

const writer = createTraceWriter(harness, {
  dir: 'out/login.twtrace',
  command: ['node', 'app.js'],
  columns: 100,
  rows: 30,
});

writer.hide();                     // keep setup noise out of the recording
await harness.waitForText('ready');
writer.show();

const step = writer.addStep('submit the form');
await harness.getByRole('button', {name: 'Submit'}).click();
writer.recordAction({api: 'locator.click', selector: 'button', ok: true});
step.end('failed', 'button stayed disabled');

await writer.finalize({idleTimeLimit: 2});   // trim gaps longer than 2s
```

`hide()` / `show()` windows drop output events entirely; markers, semantic
snapshots and step events survive and collapse onto the window's start, because
losing them would break the step list. Idle trimming happens at `finalize()`,
not while recording, so one session can be exported with different limits.

## Two timelines

Every artefact carries two times, and mixing them up is the easiest bug to write
against this format:

- **`t`** — wall-clock milliseconds since recording started.
- **`castOffset`** — position on the *cast* timeline, i.e. `t` after hidden
  windows were removed and idle gaps compressed.

`events.jsonl` stores `castOffset` on every line; readers fall back to `t` when
it is absent, so older archives still open.

## Reading an archive back

```ts
const trace = await openTrace('out/login.twtrace');
const state = await trace.stateAt(1_500);
terminal.write(state.castPrefix);          // the screen at 1.5s
console.log(state.nearestSemanticRevision);
await trace.close();
```

`stateAt()` is the time-travel primitive behind the [runner UI](../runner-ui/):
it returns the output prefix needed to reconstruct the screen, the viewport
after every resize up to that point, the newest semantic tree at or before the
moment, and the step covering it. The reader streams the archive and caches only
a small index — never the snapshots themselves.

`packTrace(dir, file)` / `unpackTrace(file, dir)` zip an archive for CI artifact
upload and read it back.

## The failure report

```ts
await generateHtmlReport({
  outFile: 'out/report.html',
  results: [{id: 't1', title: 'login', status: 'failed', tracePath: 'out/login.twtrace'}],
});
```

One HTML file, no network requests at all. For a failing test it derives the
screen before the failing step and at failure, renders both to styled HTML,
highlights the rows that changed, lists the semantic changes as plain sentences,
and embeds a player positioned on the failing step's marker.

The semantic diff is what makes it more than a screenshot pair:

```
button "Submit" state changed to disabled
text "3 issues" -> "4 issues"
dialog "Permission" removed
```

Nodes are matched by id, then by role and name, so frameworks that regenerate
ids still produce a readable diff.

With the Vitest preset you get this for free — add `TermwrightReporter` and the
run writes `<outputDir>/index.html`. Tests that only passed after a retry are
listed separately as **flaky**: a flaky test is a different problem from a
broken one, and hiding it in the pass count is how it stays broken.

## Bounds

Buffered output is capped at 32 MB by default. On overflow the writer stops
recording output and sets `meta.truncated`, while steps, semantics and events
keep recording — losing the tail of a recording beats an OOM in CI.
