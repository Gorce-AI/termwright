---
title: Protect secrets
description: Configure artifact redaction and understand which terminal, log, screenshot, report, and MCP data may remain sensitive.
---

Treat every trace, report, screenshot, CI log, and MCP response as potentially
sensitive. Termwright redacts values it knows about; it cannot discover every
application-specific secret.

## Use the default redacted mode

`artifactSecurity.mode` defaults to `redacted`. You can add exact values and
bounded patterns when launching an application:

```ts
const app = await terminal.launch({
  command: ['my-cli', 'login'],
  artifactSecurity: {
    mode: 'redacted',
    secrets: [process.env.TEST_TOKEN!],
    patterns: [{ pattern: /account_[a-z0-9]{24}/gi, maxMatchChars: 32 }],
  },
});
```

Register known values before the application can print them. A pattern needs an
explicit maximum match length so streaming redaction remains bounded.

## What redacted mode does

| Data                                        | Handling                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed, pasted, and raw input                | The recorded action value is withheld. The value is also registered for terminal-output redaction.                                                 |
| Sensitive semantic values                   | Stored as `withheld`; their known values are registered for terminal-output redaction.                                                             |
| Terminal output in a trace                  | Registered secrets and configured patterns are masked before they enter the trace. Matching works across output chunks and ANSI control sequences. |
| Terminal screenshots made from a trace      | Render the terminal output already stored in the sanitized trace.                                                                                  |
| Structured application logs                 | `@termwright/logs` applies its own credential-shaped field and configured-key redaction; trace redaction also applies session-registered values.   |
| Commands, paths, and ordinary semantic text | Recorded unless they match a registered secret or pattern.                                                                                         |

The mask preserves terminal cell width so redaction does not move later text or
invalidate recorded geometry.

## Mark input intent

Plain input strings are treated as sensitive in action records. Use the wrappers
when a value's recording policy should be explicit:

```ts
import { publicValue, sensitive } from 'termwright';

await app.type(sensitive(process.env.TEST_PASSWORD!));
await app.type(publicValue('demo-user'));
```

`publicValue()` permits the value in a redacted action record. It does not stop
the value from matching an independently configured secret or log-redaction
rule.

## Know the limits

Redaction is not secret detection. A value can remain visible when:

- the application prints it before it is registered;
- the value is transformed into an unregistered representation;
- it appears in a channel with a separate redaction policy; or
- it never matches an exact value or configured pattern.

In particular, live terminal state and the screen tail attached to crash and MCP
diagnostics may contain the application output verbatim. Treat those responses
as sensitive. Do not rely on `artifactSecurity` as permission to expose them to
an untrusted agent or public CI log.

Raw followed log-file lines do not gain a severity from Termwright. Use
structured logging with `@termwright/logs` when logs can contain credentials,
and configure application-specific key patterns at the logger boundary.

## Disable or allow raw recording

Use `none` when an artifact must not retain values or terminal output:

```ts
artifactSecurity: {
  mode: 'none',
}
```

Use `raw` only for an isolated test whose unredacted input and output are safe to
store:

```ts
artifactSecurity: {
  mode: 'raw',
}
```

Raw mode is never selected automatically.

## Secure CI artifacts

- Use test-only credentials with the smallest useful scope.
- Keep failure artifacts private and short-lived.
- Inspect a trace or report before attaching it to a public issue.
- Do not print secret environment variables while diagnosing a launch.
- Use `trace: 'off'` or security mode `none` when policy prohibits recording.

## Secure the Runner and MCP server

The browser Runner uses a local authentication token. Copy the complete URL
only to a trusted browser and do not publish it in logs.

For MCP, prefer the default STDIO transport. If you enable HTTP, bind to loopback
unless remote access is intentional and protected. MCP tools can inspect live
terminal contents and send input, so the MCP process and connected agent need
the same trust as the tested application.

## Test isolation is not redaction

The test fixture uses a private working directory and a reduced child
environment by default. This limits accidental sharing between tests but does
not sanitize data the application prints. Pass only the environment variables a
test needs; use `envMode: 'inherit'` only when deliberate.

## Related pages

- [Inspect application logs](../../guides/app-logs/)
- [Open traces and reports](../../tools/traces-reports/)
- [MCP security and transport](../mcp/)
