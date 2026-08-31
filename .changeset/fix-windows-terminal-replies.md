---
'@termwright/driver': patch
'@termwright/probe-charm': patch
---

Transport emulator query replies through ConPTY's Win32 Input Mode instead of
letting terminal protocol bytes surface as application key presses. Isolate
Bubble Tea semantic recovery state per renderer so an admitted visual flush
cannot race recovery bookkeeping and leave the semantic revision stale.
