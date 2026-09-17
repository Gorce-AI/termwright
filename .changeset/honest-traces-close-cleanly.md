---
'@termwright/trace': patch
'@termwright/mcp': patch
---

Accept recorder-produced multi-kilobyte input events in reports. Make recorded MCP terminal cleanup idempotent across retries and server restarts, keep untargeted `terminal.type` on the current focus, and add `probe: "opentui"` launch injection for Bun and Node applications.
