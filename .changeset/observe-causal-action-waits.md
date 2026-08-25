---
"@termwright/driver": patch
---

Serialize complete semantic render frames before publishing their side-channel
commit and render marker, including on ConPTY. Locator retries now expose an
`action-observation-wait` diagnostic with the correlated action ID and exact
in-flight observation state, so causal action barriers are observable without
timing-based test seams.
