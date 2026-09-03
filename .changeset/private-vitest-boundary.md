---
'@termwright/resource-broker': minor
'@termwright/test': minor
'@termwright/conformance': minor
---

Remove the public resource-broker Vitest subpath and its optional Vitest peer. Resource-aware declarations now belong exclusively to Termwright's embedded test surface, and adapter conformance uses that same owned engine instead of resolving a consumer Vitest.
