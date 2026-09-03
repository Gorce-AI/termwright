---
'@termwright/driver': patch
'@termwright/test': patch
'termwright': patch
---

Keep POSIX shell command tracking authoritative when an interactive shell enables `errexit`, so failed commands still emit their completion boundary and return an exit status instead of timing out. Generic terminal resize receipts no longer misclassify arbitrary later PTY bytes as proof of an application repaint; paired render evidence is reported only when a semantic adapter can prove it.
