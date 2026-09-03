---
'@termwright/ink': minor
'@termwright/driver': minor
'@termwright/probe-ink': minor
'@termwright/test': minor
'@termwright/ui': minor
---

Remove an unused UI provider facade and rename the Ink probe's required advanced
instrumentation entry point so no published subpath pretends an internal API is
a supported user contract. Terminal profile options now accept only the two
registered behavior profiles and configuration rejects unknown ids eagerly.
