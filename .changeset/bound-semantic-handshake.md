---
"@termwright/driver": patch
---

Separate adapter discovery from the bounded hello handshake so a peer accepted before discovery closes can authenticate deterministically, while capping active semantic sockets and refusing late peers fail-closed. Keep process cleanup deadlines in the same lazy monotonic-clock domain as their session so launch rollback remains bounded and reliable across supported Node runtimes.
