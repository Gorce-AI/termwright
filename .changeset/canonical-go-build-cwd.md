---
'@termwright/probe-charm': patch
'@termwright/probe-go': patch
'@termwright/probe-tview': patch
'@termwright/pty': patch
---

Return the canonical Go module directory required as the instrumented build cwd, preserve the caller's effective workspace, and fail closed when Charm instrumentation would replace a vendored dependency graph.

Keep Linux process-group teardown authoritative when an unrelated `/proc` entry disappears during the owned-tree scan.
