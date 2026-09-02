---
title: Security and sensitive data
description: Trace contents, redaction boundaries, MCP exposure, application logs, artifacts, and session isolation.
---

Treat traces, reports, screenshots, recordings, and application logs as test
artifacts that may contain sensitive data.

## What artifacts can contain

| Source                        | Automatic handling                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic values               | `known`, `absent`, `unknown`, `unsupported`, and `withheld` remain distinct. Sensitive known values become `withheld` before traces, Runner or MCP publication.            |
| Raw terminal output           | Not redacted. Secrets printed by the application remain visible.                                                                                                           |
| Typed keys and raw input      | `redacted` by default in receipts, traces, Runner and recorder output. `raw` is an explicit opt-in; `none` retains no value payload. Terminal output can still echo input. |
| Application logs              | Not redacted by Termwright. Configure redaction in the logger.                                                                                                             |
| File paths and process errors | May appear in reports and diagnostics.                                                                                                                                     |

Do not upload an artifact publicly until you have inspected it. Prefer
short-lived, access-controlled CI artifacts for failures involving credentials
or production-like data.

## MCP server exposure

Prefer the default STDIO transport for a local coding agent. For HTTP mode:

- bind to loopback unless remote access is intentional;
- protect the endpoint from untrusted users and networks;
- do not reuse session tokens outside their generated process;
- stop the server when the agent task finishes.

MCP tools can inspect terminal contents and send input to active sessions. Give
the MCP process the same trust level as the test process it controls.

## Test isolation

The test fixture creates a private working directory and a reduced child
environment by default. Set `cwd` or `envMode: 'inherit'` only when the test
requires shared project state or the complete parent environment. Never pass a
whole developer or CI environment merely to make one variable available.

Framework integrations authenticate their local semantic connection with a
per-session token. This protects session routing; it does not redact data the
application intentionally publishes.

## Value recording policy

`artifactSecurity.mode` is `redacted` by default. Plain input strings are treated
as sensitive. Use `sensitive(value)` to make intent explicit, or
`publicValue(value)` when a value is safe to record. Only `raw` stores sensitive
device-operation payloads; artifact readers reject a receipt whose declared
policy and stored payload disagree.
