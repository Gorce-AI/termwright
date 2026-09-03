---
'@termwright/pty': minor
'@termwright/driver': minor
'@termwright/test': minor
'@termwright/run-history': minor
'@termwright/ink': minor
'termwright': minor
---

Replace misleading generic owned-process RSS/count fields with capability-qualified whole-tree accounting. Windows sessions now capture cumulative Job Object CPU, memory, process, and I/O counters before disposal; run manifest v8 preserves their native meanings and reports unsupported platforms as unavailable.
