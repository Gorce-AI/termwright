---
'@termwright/resource-broker': minor
'@termwright/test': minor
'termwright': minor
---

Make `hostPressure: 'exclusive'` reserve the host's complete weighted capacity, and let already-active attempts acquire fitting continuation resources ahead of blocked new attempts. New attempts remain FIFO, while dynamic terminal acquisition can no longer deadlock behind a waiter that needs the active attempt's resources.
