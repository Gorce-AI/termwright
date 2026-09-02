---
'@termwright/vt': minor
'@termwright/ui': patch
---

Replace the Unicode 11 terminal model and branded profile aliases with one
Unicode 15 extended-grapheme provider and explicit `default`/`cjk-wide`
terminal policies. Runner rendering now uses exactly the same provider as live
sessions and replay, including when the selected profile changes.
