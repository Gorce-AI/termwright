---
'@termwright/protocol': minor
'@termwright/run-history': minor
'@termwright/test': minor
'termwright': minor
---

Require capability-aware resource telemetry in native run manifest v6, expose
bounded journal admission metrics, and report unavailable capabilities without
fabricated zeroes.
Attempt finalization now publishes measured worker-process CPU and sampled peak
RSS; manifest v6 validates and aggregates that evidence.
