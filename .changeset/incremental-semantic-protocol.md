---
'@termwright/protocol': minor
'@termwright/driver': minor
'@termwright/probe-runtime': minor
'@termwright/probe-ink': patch
'@termwright/probe-opentui': patch
'@termwright/probe-charm': patch
'@termwright/probe-tview': patch
'@termwright/recognizers': patch
'@termwright/trace': patch
'@termwright/ui': patch
'@termwright/mcp': patch
'@termwright/test': patch
'@termwright/conformance': patch
---

Replace protocol v2 full-snapshot publication with protocol v3 semantic
keyframes, revision-based domain deltas, explicit resynchronization, and
incrementally maintained locator indexes. The driver projects framed input
once, applies deltas atomically, and retains the last committed state after any
invalid update. All built-in TypeScript, Go, Python, and Rust producers now
speak only the new protocol.
