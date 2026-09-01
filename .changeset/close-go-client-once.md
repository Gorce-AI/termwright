---
'@termwright/protocol': patch
'@termwright/driver': patch
'@termwright/pty': patch
'@termwright/probe-charm': patch
---

Transfer ownership of the Go client's evidence-provider lease exactly once when concurrent socket and publication shutdown paths close the same session. Preserve complete race-detector diagnostics from the full tview PTY certification instead of relying on terminal-screen text that the detector does not write.

Deliver each Windows application terminal reply through the private `twh-app-reply-v1` envelope. Patched OpenConsole buffers the complete OSC, validates its length and encoding, then commits the decoded reply in one input-buffer operation regardless of the child's VT-input mode. This prevents both per-byte mode-report corruption and raw CPR consumption as an F3 key.
