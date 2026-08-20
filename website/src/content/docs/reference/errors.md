---
title: Errors
description: Stable Termwright error kinds, what they mean, and the next diagnostic step.
---

Termwright errors include a stable `kind`, a message, and when applicable a
suggestion or bounded candidate list. Use `kind` for programmatic handling and
the message for diagnostics.

| Kind | Meaning | Next step |
| --- | --- | --- |
| `timeout` | A retryable operation did not settle before its deadline. | Inspect the last screen and trace; verify the awaited outcome. |
| `ambiguous-locator` | A strict locator matched more than one node. | Scope the locator or add a distinguishing accessible name. |
| `unsupported-action` | The framework or terminal cannot prove the requested input is safe. | Use keyboard input or a supported framework capability. |
| `stale-snapshot` | A reference belongs to an older semantic revision. | Keep the locator, not a resolved node, across UI changes. |
| `protocol-violation` | A probe sent invalid, oversized, or inconsistent data. | Check the integration version and probe diagnostics. |
| `capacity` | A configured or negotiated resource limit was reached. | Reduce retained data or adjust the documented limit. |
| `process-exited` | The application exited before the operation completed. | Inspect exit status, crash metadata, and terminal tail. |
| `session-closed` | The test used a session after teardown or explicit close. | Keep work inside the owning test or fixture lifetime. |
| `history-truncated` | Requested evidence is older than retained history. | Use the trace artifact or retain a larger history window. |

Observation failures also distinguish `unknown` from `unsupported`. Unknown can
become known on a later rendered revision and is retried by matchers. Unsupported
cannot become available for that framework capability and fails immediately.

CLI JSON errors use the same taxonomy. Process exit codes are listed in the
[CLI reference](../cli/).

For symptom-oriented investigation, see [Debug a failed test](../../tools/debugging/).
