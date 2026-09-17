---
'@termwright/pty': patch
---

Build the Win32 observable-resize certification fixture ahead of the measured ConPTY session. This removes runtime C# compilation from the startup handshake proof and makes x64-on-ARM64 certification depend only on terminal events.
