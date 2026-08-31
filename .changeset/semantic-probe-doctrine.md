---
'@termwright/driver': minor
'@termwright/probe-charm': minor
'@termwright/probe-go': minor
'@termwright/probe-ink': minor
'@termwright/probe-opentui': minor
'@termwright/probe-tview': minor
'@termwright/protocol': minor
'@termwright/ui': minor
---

Expose and validate per-run semantic probe intervention metadata, including the
engaged injection tier, geometry class, and named degraded capabilities. The
effective session contract and Runner now preserve those facts so reduced
framework coverage cannot silently look complete.

Add the generic Go `-toolexec` path for compiler-checked, add-only package units.
tview and Bubbles builds reuse a content-addressed compiler identity across
temporary materialisation directories while invalidating it for changed owned
sources or injected import archives.
tview now uses one dormant application attachment plus public draw hooks and
owned tview/tcell units without copying or patching upstream modules. Bubbles
private-state readers use the same mechanism, while Bubble Tea retains only the
exact model and render-flush hooks required for causal semantic publication.

OpenTUI moves semantic geometry and hit-grid observation to runtime hooks while
retaining its narrow structural native-output transform. Ink includes the
composable React commit bridge and differential evidence explaining why exact
renderer instrumentation remains necessary for full fidelity.

Ratatui now sizes its asynchronous publication queue from the negotiated
semantic in-flight limit instead of a scheduler-sensitive hard-coded value.
`terminal.launch({ semanticFrameQueueCapacity })` can raise that bounded limit
for intentional synchronous render bursts, and an exact overflow diagnostic
reports the active budget and an actionable remediation.
