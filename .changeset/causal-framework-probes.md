---
"@termwright/probe-charm": patch
"@termwright/probe-opentui": patch
"@termwright/probe-tview": patch
"termwright": patch
---

Commit semantic frames only at causal framework output boundaries. OpenTUI now
observes render geometry at runtime instead of patching generated render-loop
operations; Bubble Tea commits staged model observations after renderer flush;
and tview commits after `Screen.Show` with same-output marker ordering on Unix
and Windows.

The Termwright CLI now projects recognized toolchain and
candidate-certification controls into Vitest's explicit worker configuration,
so required Go/Bun and candidate-profile requirements remain visible at module
evaluation.

Textual strong instrumentation is pinned to its certified framework version,
rejects partial display attempts, publishes only fresh post-handshake frames,
and appends markers non-blockingly through the exact frame writer.
