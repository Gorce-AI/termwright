---
title: "Type Alias: DiagnosticCode"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / DiagnosticCode

# Type Alias: DiagnosticCode

> **DiagnosticCode** = `"negotiation-timeout"` \| `"adapter-attached"` \| `"adapter-disconnected"` \| `"adapter-capability"` \| `"adapter-guarantee-violation"` \| `"duplicate-semantic-key"` \| `"revision-commit"` \| `"revision-superseded"` \| `"revision-pairing-watchdog"` \| `"revision-dropped"` \| `"marker-unverified"` \| `"protocol-violation"` \| `"endpoint-error"` \| `"degraded-output-drain"` \| `"action-observation-wait"` \| `"truncated-output"` \| `"listener-error"` \| `"log-dropped"` \| `"log-source"` \| `"ready-shell-integration"` \| `"terminal-response"` \| `"terminal-response-after-input-close"` \| `"mode-unverifiable"`

Defined in: [driver/src/api.ts:844](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L844)

Closed set of session diagnostic codes. Adding a code is a contract change:
conformance suites assert on them.
