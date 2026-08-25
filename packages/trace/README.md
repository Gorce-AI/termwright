# @termwright/trace

The `.twtrace` archive format for [termwright](https://github.com/gorce-ai/termwright):
a writer that records a live terminal session, a streaming reader that powers
time travel in the runner UI, and a self-contained HTML failure report.

An archive is a directory (zippable for transport):

| File | Content |
|---|---|
| `meta.json` | session id, command, viewport, platform, terminal profile, exit, crash, log summary |
| `session.cast` | asciicast **v3**; `test.step()` titles become markers |
| `events.jsonl` | inputs, resizes, steps, driver actions, assertions, crash |
| `semantics.jsonl` | one semantic tree per revision, with its cast offset |
| `logs.jsonl` | application log entries; absent when the session logged nothing |
| `COMMITTED` | versioned SHA-256 manifest written last before atomic publication |

The layout is normative in [`/CONTRACTS.md`](../../CONTRACTS.md) §Trace. Nothing
outside this package reads or writes those files directly.

## Install

```sh
pnpm add @termwright/trace
```

Requires Node >= 22. ESM only.

## Recording

```ts
import { createTraceWriter } from '@termwright/trace';

const writer = createTraceWriter(harness, {
  dir: 'out/login.twtrace',
  command: ['node', 'app.js'],
  columns: 100,
  rows: 30,
});

writer.hide();                     // keep setup noise out of the recording
await harness.waitForText('ready');
writer.show();

const step = writer.addStep('submit the form');  // → cast marker "submit the form"
await harness.getByRole('button', { name: 'Submit' }).click();
step.end('failed', 'button stayed disabled');

await writer.finalize({ idleTimeLimit: 2 });     // trim gaps longer than 2s
```

The writer attaches to anything exposing `sessionId` and `events` — a
`TerminalHarness`, or a fake in tests. Driver actions, application logs and
crashes arrive on their own through those events; nothing above reports them by
hand. `recordAction` exists only for work the driver cannot see, and calling it
for a harness action would record that action twice.

Nothing is published until `finalize()`, because that is the first moment the
timeline is known. Finalization writes and fsyncs a sibling staging directory,
then atomically renames it into place. A crash or ENOSPC leaves an explicitly
incomplete staging artifact; readers require and verify `COMMITTED`.

## The two timelines

Every artefact carries two times, and mixing them up is the easiest mistake to
make here:

- **`t`** — wall-clock milliseconds since recording started.
- **`castOffset`** — position on the *recording*: `t` after `hide()` windows
  were cut out and idle gaps compressed.

They are equal only in a recording that was neither hidden nor trimmed, so
`castOffset` is required on every line and readers never fall back to `t`. A
line missing it is rejected as corrupt rather than placed at a plausible wrong
moment.

Everything a player or UI seeks to is a `castOffset`.

## Reading

```ts
import { openTrace } from '@termwright/trace';

const trace = await openTrace('out/login.twtrace');   // directory or zip

const state = await trace.stateAt(1_500);
state.castPrefix;                // output to write into an emulator
state.columns;                   // viewport after resizes up to that point
state.nearestSemanticRevision;   // newest tree at or before it
state.step;                      // the step covering that moment
state.logs;                      // preceding log entries, bounded

for await (const event of trace.events()) console.log(event.kind, event.castOffset);
for (const step of await trace.steps()) console.log(step.title, step.status);

await trace.close();
```

Failures come back with a code that says whose mistake it was: `not-found` when
the path holds no archive, `protocol-violation` when it holds a broken one.

`stateAt` is the time-travel primitive: scrub to an offset, get everything
needed to render that moment. `packTrace(dir, file)` and
`unpackTrace(file, dir)` zip an archive for CI upload and read it back.

## Frames, and why they line up

```ts
import { frameAt } from '@termwright/trace';

const frame = await frameAt(trace, 1_500);
frame.cell(3, 10);   // a driver-shaped CellSnapshot
frame.text();
```

`frameAt` replays the output prefix back into a cell grid shaped like the
driver's `ScreenSnapshot`, so a recorded moment can be inspected cell by cell or
handed to [`@termwright/screenshot`](../screenshot).

It measures characters with the profile the session used
(`meta.terminalProfile`, captured from `TerminalHarness.terminalProfile`) through
the shared emulator in `@termwright/vt`. That matters more than it sounds: when
the session and its replay used different width tables, an emoji was two columns
live and one on replay, and the screenshot quietly disagreed with the assertion.
An archive naming a profile this build does not know is rejected rather than
replayed with the wrong tables.

## Application logs

A TUI cannot print diagnostics to the screen without corrupting the render, so
`logs.jsonl` carries what the program said about itself: lines from a followed
log file, and structured records from an adapter that negotiated the `logs`
capability. Both land in one shape with a `message` field, so nothing has to
branch on provenance before printing an entry.

```ts
if (trace.meta.logs !== undefined) {
  for await (const entry of trace.logs()) {
    console.log(entry.level ?? 'log', entry.label, entry.message);
  }
}

// Or just the window leading up to a moment, for a scrubbing UI:
const around = await trace.stateAt(1_500, { logWindow: 50 });
```

`label` is the display name of the stream; `logger` and `path` are kept
separately, because filtering by channel (`db.pool`) or attributing a line to a
file are different questions from "which stream do I render this under" — and a
label may be shared between sources.

A followed file line carries **no level**. The driver does not infer one from
the text and neither does this package: colouring a report by substring match is
wrong often enough to be worse than no colour.

`meta.logs` summarises the file — count, per-level counts, sources — and reports
how many entries were evicted. The writer keeps the most recent `maxLogEntries`
(10 000 by default), because when a program floods its log the end is the part
worth keeping.

Redaction happens at the source, in `@termwright/logs`. **Lines tailed from a
log file are not redacted**: they arrive as raw text, so treat them the way you
treat a crash's screen tail.

Semantic values and input/action payloads use `artifactValuePolicy`:
`redacted` (the secure default), `none`, or explicit `raw`. Sensitive semantic
values are stored as typed `withheld` observations. Executable keyboard values
never enter an `ActionReceipt`; receipts contain recorded projections only.

## When the program dies on its own

A signal, or a non-zero exit nobody asked for, lands in `meta.crash` and is
marked on the timeline in `events.jsonl`.

```ts
if (trace.meta.crash !== undefined) {
  console.error(trace.meta.crash.screenTail.join('\n'));
  const tree = await trace.crashSemantic();   // the tree current at the time
}
```

**`meta.crash.screenTail` is not redacted.** It is what the terminal showed,
verbatim — whatever the program or the tty's echo displayed is in there, secrets
included. Treat an archive carrying a crash like a screenshot when you store it,
upload it as a CI artifact or forward it. Input previews are omitted unless the
session explicitly selected raw artifact values. This does not protect text the
application echoed to the terminal.

## The report

```ts
import { generateHtmlReport } from '@termwright/trace';

await generateHtmlReport({
  outFile: 'out/report.html',
  results: [
    { id: 't1', title: 'login', status: 'failed', tracePath: 'out/login.twtrace' },
  ],
});
```

One HTML file that makes no network requests at all — the asciinema player is
inlined from `node_modules` at generation time.

For a failing test it derives the screen before the failing step and at failure,
renders both to styled HTML with the changed rows highlighted, lists the
semantic changes as sentences (`button "Submit" state changed to disabled`),
shows the crash panel and the logs from the failing step, and embeds the
recording positioned on that step's marker. Failed driver actions sit on the
timeline beside the steps with their error code, so a failure reads as "the
click never landed, and here is why" rather than as a screen that did not
change.

A test that **passed** keeps its archive too under `trace: 'on'`: its section is
collapsed, but it names the `.twtrace` path and shows the whole log.

Callers that already have the pieces can supply them instead of a trace —
`visual` and `semantic` for a snapshot mismatch, `crash` when recording was off,
`screenshots` for PNGs from `@termwright/screenshot`. The report embeds images;
it never rasterises anything itself, which keeps a native renderer out of every
test run.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

Implementation decisions and open threads: [`NOTES.md`](./NOTES.md).
