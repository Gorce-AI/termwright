---
'@termwright/protocol': minor
'@termwright/run-journal-transport': minor
'termwright': minor
---

Bound EventJournal admission by serialized bytes as well as event count, expose
peak backlog telemetry, and replace per-event worker RPCs with bounded batches.
Run-event protocol v3 also bounds event, producer, collision, and
causal-reference validation state; causes must refer backwards within the
declared horizon.
