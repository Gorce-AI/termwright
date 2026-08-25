---
"@termwright/ink": patch
"@termwright/driver": patch
"termwright": patch
---

Roll back partially acquired semantic and Ink control endpoints when
Unix-socket or Windows named-pipe listener startup fails, including
deterministic cleanup-error reporting instead of leaking endpoint lifecycles.
