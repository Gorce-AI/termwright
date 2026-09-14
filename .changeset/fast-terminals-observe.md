---
'@termwright/driver': minor
'@termwright/gherkin': minor
'@termwright/ink': minor
'@termwright/mcp': minor
'@termwright/probe-opentui': minor
'@termwright/protocol': minor
'@termwright/test': minor
'@termwright/trace': minor
'termwright': minor
---

Add revision-driven `waitUntil` and focus traversal, explicit keyboard or pointer action routing, and Kitty progressive keyboard support. Timeout errors now explain pending observation evidence and include the last observed value.

Add abort-aware, exactly-once fixture resource scopes and managed sidecar processes. Gherkin scenarios can map tags to timeouts and resources, and receive the same scoped lifecycle.

Keep literal test IDs intact, stop treating named control keys as trace secrets, and expose OpenTUI text only when the concrete renderer prototype proves it is read-only.
