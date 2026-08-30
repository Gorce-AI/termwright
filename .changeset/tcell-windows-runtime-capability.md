---
'@termwright/probe-tview': patch
---

Detect the tcell Windows marker capability from the framework-owned console handle instead of the removed private `cScreen.vten` field, including causal legacy Console API conformance on vendored ConPTY.
