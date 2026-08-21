---
title: "Type Alias: DiagnosticCode"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / DiagnosticCode

# Type Alias: DiagnosticCode

> **DiagnosticCode** = `"negotiation-timeout"` \| `"adapter-attached"` \| `"adapter-disconnected"` \| `"adapter-capability"` \| `"revision-commit"` \| `"revision-superseded"` \| `"revision-expired"` \| `"revision-dropped"` \| `"marker-unverified"` \| `"protocol-violation"` \| `"endpoint-error"` \| `"listener-error"` \| `"delta-resync"` \| `"log-dropped"` \| `"log-source"` \| `"ready-shell-integration"` \| `"ready-settled-screen"` \| `"mode-unverifiable"`

Defined in: [api.ts:546](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L546)

Closed set of session diagnostic codes. Adding a code is a contract change:
conformance suites assert on them.
