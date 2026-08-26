---
"@termwright/driver": patch
"@termwright/screenshot": patch
"termwright": patch
---

Preserve native ConPTY output, exit evidence, and the first fatal I/O error
emitted before the terminal journal attaches, and make managed PowerShell
readiness a causal startup marker instead of a quiet-window input race.

Load screenshot fallback fonts only when a requested glyph needs them and keep
the shared parsed-face cache bounded and file-identity-aware. ASCII screenshots
no longer eagerly parse Windows CJK and emoji collections, while style,
fallback, and colour-emoji fidelity remain unchanged.
