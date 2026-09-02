---
'@termwright/run-history': minor
'@termwright/ui': minor
'termwright': minor
---

Replace finalize-heavy embedded run events with manifest v5 and an append-only,
independently checksummed `events.ndjson` stream. Keep live event projections
bounded while canonical history is written batch by batch.
