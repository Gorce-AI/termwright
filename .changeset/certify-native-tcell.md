---
'@termwright/probe-tview': patch
---

Compile the owned, add-only tcell marker capability only for native Windows
builds through the official Go tool-executor seam. The compiler and native
Windows conformance now verify the capability without replacing or hashing an
upstream tcell source file; unsupported shapes fail the build loudly.
