---
"@termwright/probe-ink": patch
"@termwright/probe-opentui": patch
---

Pass native absolute paths to Bun's preload resolver while retaining file URLs
for Node imports. This makes the zero-config launchers work on Windows; their
process contracts now surface preload exit diagnostics before waiting for
semantic evidence.
