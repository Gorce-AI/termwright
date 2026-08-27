---
'@termwright/pty': minor
'@termwright/pty-win32-arm64': minor
'@termwright/pty-win32-x64': minor
'@termwright/driver': minor
'@termwright/conformance': minor
'@termwright/probe-tview': minor
'@termwright/probe-ink': minor
'@termwright/probe-opentui': minor
'@termwright/probe-charm': minor
---

Ship and verify a pinned modern Microsoft ConPTY runtime on Windows so semantic
frame markers preserve causal output ordering. Windows sessions now fail closed
when the complete certified runtime bundle cannot be loaded instead of silently
using the inbox conhost implementation. The ordered passthrough stream also
restores authoritative mouse/focus mode observation on Windows, and the tview
marker writer now brackets its causal write with an exact VT output-mode guard.
Ink, OpenTUI, and Bubble Tea share the same mode-safe exact-handle marker
contract under Node and Bun.
