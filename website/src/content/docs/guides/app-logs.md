---
title: Application logs
description: Follow an application log file and assert on its records.
---

Use application logs for diagnostics that should not be printed into a
full-screen TUI. Termwright can follow a file and make its records available to
assertions and failure traces.

## Follow a log file

```ts
const app = await terminal.launch({
  command: [process.execPath, appFile],
  logs: [{ path: 'var/editor.log', label: 'editor' }],
});
```

Termwright waits for a file that is created after launch. Existing files are
followed from their current end, so records from an earlier test are not read.
Truncation and rotation restart the tail and add a diagnostic record.

## Assert on logs

```ts
await expect(app).toHaveLogged({
  source: 'file',
  label: 'editor',
  message: /saved in \d+ms/,
});

expect(terminal.logs.filter({ source: 'file', label: 'editor' }).length).toBeGreaterThan(0);
```

`terminal.logs` combines records from every application launched by the test.
File-log queries can filter by source, label, message, or session id.
`toHaveLogged()` retries until its timeout. Raw file lines do not receive an
inferred severity, so do not filter them by `level` or `minLevel`.

`@termwright/logs` provides normalization, source-side redaction, and optional
adapters for Pino, Winston, Consola, and OpenTelemetry. Its Node diagnostics
channel is process-local; a launched application needs a framework or custom
transport that forwards those records to its Termwright session. Publishing to
`diagnostics_channel` in the child process alone does not send a record to the
test process.

When a custom integration forwards structured records, do not treat the list
as complete if `lostRecords()` is non-zero. Runner and reports show the same
incomplete-record warning.

## Redaction

Default redaction covers credential-shaped values and credential-like attribute
keys such as `password`, `token`, `authorization`, `apiKey`, and `cookie`.
Configure an additional key pattern when an application has a domain-specific
secret shape.

Raw followed file lines have no structured attribute keys to inspect. Register
their known secrets with the session artifact policy, and do not write
production credentials to a test log. See [Protect secrets](../../reference/security/)
for terminal-output, trace, screenshot, and MCP boundaries.

## Logs in replay

Traces store logs in `logs.jsonl`. Runner shows records only up to the current
playhead and marks notable levels on the timeline. A missing or truncated log
file is reported explicitly instead of being interpreted as an empty log.

See [Debug a failed test](../../tools/debugging/) and
[Traces and reports](../../tools/traces-reports/).
