---
"@termwright/driver": patch
"termwright": patch
---

Decompose terminal sessions into independently tested process, evidence,
action, input-barrier, and semantic-contract units, and split the persistent
test host into explicit coordination, Vitest-adapter, and persistence/finalizer
components. Public behavior, event ordering, teardown, and failure semantics
remain unchanged.
