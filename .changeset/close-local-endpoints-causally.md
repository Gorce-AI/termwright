---
'@termwright/driver': patch
'@termwright/resource-broker': patch
'@termwright/run-journal-transport': patch
---

Make local endpoint shutdown a causal barrier on Windows and POSIX. Accepted semantic sockets are now destroyed before listener completion, late connections are rejected during shutdown, and listener cleanup still completes when an individual socket teardown reports an error.
