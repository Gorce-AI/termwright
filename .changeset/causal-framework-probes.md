---
'@termwright/probe-charm': patch
'@termwright/probe-go': patch
'@termwright/probe-opentui': patch
'@termwright/probe-tview': patch
'termwright': patch
---

Commit semantic frames only at causal framework output boundaries. OpenTUI now
observes render geometry at runtime instead of patching generated render-loop
operations; Bubble Tea commits staged model observations after renderer flush;
its frame-to-marker admission is non-blocking and fails concurrent/reentrant
flushes closed before output rather than stalling a render loop;
transient queue saturation or admission ownership now coalesces one causal
event-loop replay that observes the current model and forces a real renderer
flush, while transport and integrity failures remain fail-closed;
disabled Bubble Tea probing is cached once and leaves later render/flush calls
as allocation-free atomic no-ops;
and tview chains public draw hooks to arm only the final call through its screen
decorator. Intermediate custom/hook `Show` calls cannot publish partial trees;
the final boundary publishes a compiler-checked add-only semantic snapshot with
same-output marker ordering on Unix and Windows. Existing tview and tcell source
files are no longer copied or patched.

The Termwright CLI now projects recognized toolchain and
candidate-certification controls into Vitest's explicit worker configuration,
so required Go/Bun and candidate-profile requirements remain visible at module
evaluation.

Textual strong instrumentation is admitted by runtime capability checks and
behavioral conformance, rejects partial display attempts, publishes only fresh
post-handshake frames, and appends markers non-blockingly through the observed
frame writer. Its private causal seam remains explicit T3 debt without a
version allowlist.

Framework compatibility now reports the intervention tier per capability,
semantic class, named degradation and tracked T3 debt. Capability-driven T1
candidate runs compile owned units directly against tview, tcell and Bubbles;
they no longer manufacture exact source profiles for integrations that do not
edit upstream bytes.
