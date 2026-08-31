---
'@termwright/resource-broker': patch
'@termwright/run-journal-transport': patch
---

Consolidate authenticated local IPC framing, hostile-input decoding, typed
envelopes, token comparison, and endpoint lifecycle into one shared transport.
Journal shutdown now drains every already-received append before its close
barrier resolves and reports persistence failures after endpoint cleanup.
