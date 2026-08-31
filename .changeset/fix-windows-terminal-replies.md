---
'@termwright/driver': patch
'@termwright/protocol': patch
'@termwright/pty': patch
'@termwright/pty-win32-arm64': patch
'@termwright/pty-win32-x64': patch
'@termwright/probe-charm': patch
---

Preserve ConPTY terminal-query provenance: host control replies remain raw,
cursor synchronization uses a private request-addressed OpenConsole RPC, and
ordinary application replies use Win32 Input Mode instead of surfacing as key
presses.
Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
flush cannot race recovery bookkeeping and leave the semantic revision stale.
