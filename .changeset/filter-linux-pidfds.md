---
"@termwright/driver": patch
"@termwright/pty": patch
---

Filter Linux process-group candidates before opening pidfds, preserve the
post-open identity check, and surface native lifecycle errno diagnostics with
open-file-limit guidance instead of reporting an unproven live process tree.
