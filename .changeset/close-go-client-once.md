---
'@termwright/protocol': patch
'@termwright/driver': patch
'@termwright/pty': patch
'@termwright/probe-charm': patch
---

Transfer ownership of the Go client's evidence-provider lease exactly once when concurrent socket and publication shutdown paths close the same session. Preserve complete race-detector diagnostics from the full tview PTY certification instead of relying on terminal-screen text that the detector does not write.

Keep each Windows application terminal reply as one complete raw VT transaction through OpenConsole. Do not split a mode report into per-byte synthetic key records that can expose its printable tail as Bubble Tea user input under pressure.
