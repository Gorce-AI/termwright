---
'@termwright/pty': patch
---

Defer Windows terminal responses until the native output callback has fully returned to libuv. Responses remain ordered and memory-bounded, and asynchronous native rejection is reported through the PTY error channel. This fixes intermittent startup handshake stalls under x64 Node emulation on Windows ARM64.
