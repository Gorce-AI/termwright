---
'@termwright/driver': patch
'@termwright/pty': patch
'@termwright/probe-charm': patch
---

Preserve ConPTY terminal-query provenance: host control replies remain raw,
cursor reports use OpenConsole's causal capture/pass-through seam, and other
application replies use Win32 Input Mode instead of surfacing as key presses.
Isolate Bubble Tea semantic recovery state per renderer so an admitted visual
flush cannot race recovery bookkeeping and leave the semantic revision stale.
