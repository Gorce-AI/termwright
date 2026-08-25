---
"@termwright/mcp": minor
"@termwright/ui": minor
"termwright": minor
---

Harden live HTTP and Runner boundaries with per-launch MCP bearer
authentication, exact Origin policy, explicit non-loopback opt-in, bounded
authenticated and preflight rate limits, and opt-in token disclosure.

Runner viewers and producers now use separate credentials. Producer ownership
is bound to a run generation, semantic snapshots are validated at ingress, and
UTF-8 replay/client queues have strict byte ceilings with deterministic
disconnect and cleanup behavior.
