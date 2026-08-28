---
'@termwright/conformance': patch
'@termwright/driver': patch
---

Make action observation waits causal across independent Windows semantic and
PTY transports: pending frames arm before inspection and wake on lifecycle
transitions. Close adapter probe artifacts only after endpoint admission, the
owned process tree, authoritative output EOF, and terminal parser drain have
all completed.
