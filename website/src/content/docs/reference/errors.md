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
| `semantic-capability-unavailable` | A semantic locator was used without a semantic integration. | Install the framework integration or use `getByScreenText()` for physical terminal text. |
| `probe-attach-failed` | The launch required semantic integration, but no probe completed negotiation. | Verify the certified launcher/injection path. For Python, do not use `-S` or `-E`. |
| `capability-unavailable` | The frozen session contract does not include a fact or operation the request needs. | Require the capability at launch or add a certified adapter/provider. |
| `not-actionable` | The capability exists, but the target is currently hidden, disabled, detached, covered, or otherwise cannot receive the action. | Inspect `locator.actionability()` and the current committed state. |
| `input-mode-disabled` | The physical device exists, but the application has not enabled the required terminal mode. | Enable the relevant mouse, motion, or focus reporting mode in the application. |
| `capability-provider-lost` | An application evidence provider disappeared after its contract was frozen. | Inspect the provider lifecycle; start a new session after fixing it. |
| `capability-provider-violation` | A provider published stale, conflicting, or invalid evidence. | Fix the provider/router integration; Termwright will not downgrade it. |
| `adapter-guarantee-violation` | A certified adapter failed to deliver evidence it guaranteed. | Check the exact framework/adapter instrumentation and certification diagnostics. |
| `duplicate-semantic-key` | Two live nodes declared the same explicit application identity. This is fatal and never degrades to frame-local identity. | Give every non-empty `SemanticKey` a unique value in the committed tree. |
| `stale-snapshot` | A reference belongs to an older semantic revision. | Keep the locator, not a resolved node, across UI changes. |
| `protocol-violation` | A probe sent invalid, oversized, or inconsistent data. | Check the integration version and probe diagnostics. |
| `capacity` | A configured or negotiated resource limit was reached. | Reduce retained data or adjust the documented limit. |
| `process-exited` | The application exited before the operation completed. | Inspect exit status, crash metadata, and terminal tail. |
| `session-closed` | The test used a session after teardown or explicit close. | Keep work inside the owning test or fixture lifetime. |
| `history-truncated` | Requested evidence is older than retained history. | Use the trace artifact or retain a larger history window. |

Observation failures also distinguish `unknown` from `unsupported`. Unknown is
temporary and names a revision domain that may settle it. Unsupported is outside
the frozen contract and fails immediately. A settled guaranteed observation may
only be known or authoritatively absent.

CLI JSON errors use the same taxonomy. Process exit codes are listed in the
[CLI reference](../cli/).

For symptom-oriented investigation, see [Debug a failed test](../../tools/debugging/).
