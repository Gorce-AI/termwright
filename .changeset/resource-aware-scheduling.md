---
'@termwright/resource-broker': minor
'@termwright/test': minor
'@termwright/run-history': minor
'termwright': minor
---

Resolve worker and terminal admission from cgroup-aware CPU, memory, and temp
disk budgets, and atomically schedule every attempt with CPU/memory/I/O weights.
Use a bounded local p50/p95/EWMA cache to raise memory admission from measured
worker RSS while retaining conservative defaults for new tests.
