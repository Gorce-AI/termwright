---
"@termwright/ui": patch
"termwright": patch
---

Remove migration of pre-release Runner preference keys. The Runner now reads
only its current versioned preference storage and otherwise starts from fresh
defaults, without retaining compatibility paths for unpublished schemas.
