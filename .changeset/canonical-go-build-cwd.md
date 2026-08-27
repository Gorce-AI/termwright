---
'@termwright/probe-charm': patch
'@termwright/probe-go': patch
'@termwright/probe-tview': patch
---

Return the canonical Go module directory required as the instrumented build cwd, preserve the caller's effective workspace, and fail closed when Charm instrumentation would replace a vendored dependency graph.
