---
title: Application logs
description: Capture structured application logs or follow a log file and assert on records.
---

Use application logs for diagnostics that should not be printed into a
full-screen TUI. Termwright can follow a file or receive structured records from
an instrumented application.

## Follow a log file

```ts
const app = await terminal.launch({
  command: [process.execPath, appFile],
  logs: [{path: 'var/editor.log', label: 'editor'}],
});
```

Termwright waits for a file that is created after launch. Existing files are
followed from their current end, so records from an earlier test are not read.
Truncation and rotation restart the tail and add a diagnostic record.

## Assert on logs

```ts
await expect(app).toHaveLogged({
  level: 'info',
  message: /saved in \d+ms/,
});

expect(app.logs.filter({minLevel: 'warn'})).toEqual([]);
```

Queries can filter by level, source, label, logger, message, or session id.
`toHaveLogged()` retries until its timeout.

By default, a test that otherwise passes fails when the application emitted a
structured `error` record. Change the threshold with
`failOnLogLevel: 'warn' | 'fatal' | false`. Raw file lines do not receive an
inferred severity.

## Publish structured records in Node.js

Applications can use the public diagnostics channel without a Termwright
dependency:

```ts
import {channel} from 'node:diagnostics_channel';

channel('termwright:log').publish({
  level: 'error',
  message: 'save failed',
  attrs: {documentId: '42'},
});
```

`@termwright/logs` adds normalization, source-side redaction, lazy records, and
optional bridges for Pino, Winston, Consola, and OpenTelemetry.

## Publish from framework probes

Python, Go, and Rust protocol clients can install their logging bridge after a
semantic client connects. The bridge remains dormant outside a Termwright
session and respects the negotiated record budget.

Do not treat the received list as complete when `lostRecords()` is non-zero.
Runner and reports show the same incomplete-evidence warning.

## Redaction

Default redaction covers credential-shaped values and credential-like attribute
keys such as `password`, `token`, `authorization`, `apiKey`, and `cookie`.
Configure an additional key pattern when an application has a domain-specific
secret shape.

Raw followed file lines and terminal output are application output. Do not
write secrets to them if traces or reports will be retained.

## Logs in replay

Traces store logs in `logs.jsonl`. Runner shows records only up to the current
playhead and marks notable levels on the timeline. A missing or truncated log
file is reported explicitly instead of being interpreted as an empty log.

See [Debug a failed test](../../tools/debugging/) and
[Traces and reports](../../tools/traces-reports/).
