---
"@termwright/driver": minor
"@termwright/pty": minor
"@termwright/pty-darwin-arm64": minor
"@termwright/pty-darwin-x64": minor
"@termwright/pty-linux-arm64": minor
"@termwright/pty-linux-x64": minor
"@termwright/pty-win32-arm64": minor
"@termwright/pty-win32-x64": minor
---

Replace node-pty and the separate ConPTY loader with one Termwright-owned native
PTY backend that provides authoritative output EOF and owned process trees on
all supported platforms. Native input admission and native-to-JavaScript output
delivery are bounded and backpressured; overflow, write failure, missing Windows
completion-port support, and missing platform addons fail closed.
