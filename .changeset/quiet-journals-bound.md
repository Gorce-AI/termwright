---
'@termwright/run-journal-transport': minor
'@termwright/test': minor
---

Bound worker event production before deferred transport work is created. Hot-path events now use synchronous count-and-byte admission and an explicit drain barrier, so a slow or failed journal sink cannot create an unbounded Promise chain or hide authoritative delivery failure.
