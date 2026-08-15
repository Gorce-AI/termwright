# @termwright/trace

The `.twtrace` archive format for [termwright](https://github.com/gorce-ai/termwright):
a writer that records a live terminal session, a streaming reader that powers
time travel in the runner UI, and a self-contained HTML failure report with a
visual diff, a semantic diff and an embedded recording.

An archive is a directory (zippable for transport) holding four files:

| File | Content |
|---|---|
| `meta.json` | session id, command, viewport, platform, exit status |
| `session.cast` | asciicast **v3**; `test.step()` titles become markers |
| `events.jsonl` | inputs, resizes, steps, locator actions, assertions |
| `semantics.jsonl` | one semantic tree per revision, with its cast offset |

The layout is normative in [`/CONTRACTS.md`](../../CONTRACTS.md) §Trace. Nothing
outside this package reads or writes those files directly.

## Install

```sh
pnpm add @termwright/trace
```

Requires Node >= 22. ESM only.

## Usage

```ts
import { createTraceWriter, openTrace, generateHtmlReport } from '@termwright/trace';

// 1. Record. The writer subscribes to the harness's session events.
const writer = createTraceWriter(harness, {
  dir: 'out/login.twtrace',
  command: ['node', 'app.js'],
  columns: 100,
  rows: 30,
});

writer.hide();                       // keep setup noise out of the recording
await harness.waitForText('ready');
writer.show();

const step = writer.addStep('submit the form');   // -> cast marker "submit the form"
await harness.getByRole('button', { name: 'Submit' }).click();
writer.recordAction({ api: 'locator.click', selector: 'button', ok: true });
step.end('failed', 'button stayed disabled');

await writer.finalize({ idleTimeLimit: 2 });      // trim gaps longer than 2s

// 2. Read back — `stateAt` is the time-travel primitive.
const trace = await openTrace('out/login.twtrace');
const state = await trace.stateAt(1_500);
terminal.write(state.castPrefix);                  // screen at 1.5s
console.log(state.nearestSemanticRevision);        // newest tree at or before it
await trace.close();

// 3. Report.
await generateHtmlReport({
  outFile: 'out/report.html',
  results: [{ id: 't1', title: 'login', status: 'failed', tracePath: 'out/login.twtrace' }],
});
```

## What each piece is for

**`createTraceWriter(session, options)`** — attaches to anything exposing
`sessionId` and `events` (a `TerminalHarness`, or a fake in tests). `hide()`
and `show()` exclude windows of output from the recording; `addStep(title)`
writes a marker; `finalize({ idleTimeLimit })` applies the hide and trim
transforms, stamps every artefact with its `castOffset`, and writes the archive.

**`openTrace(path)`** — opens a directory or a zip, validates versions, and
streams cast events, trace events and semantic records. `stateAt(timeMs)`
returns the output prefix needed to reconstruct the screen, the viewport after
resizes, the nearest earlier semantic revision, and the step covering that
moment.

**`diffSemanticSnapshots(before, after)`** — structured diff plus plain-English
sentences: `button "Submit" state changed to disabled`. Nodes are matched by id,
then by role and name, so frameworks that regenerate ids still produce a
readable diff.

**`generateHtmlReport(options)`** — one HTML file, no network requests at all.
For a failing test it derives the screen before the failing step and at failure,
renders both to styled HTML, highlights the rows that changed, lists the
semantic changes as sentences, and embeds an asciinema player positioned on the
failing step's marker. Callers with their own before/after screens or trees (a
snapshot mismatch, say) can pass them directly via `visual` and `semantic`.

**`packTrace(dir, file)` / `unpackTrace(file, dir)`** — zip an archive for CI
artifact upload and read it back.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

Implementation decisions and open threads: [`NOTES.md`](./NOTES.md).
