---
"termwright": patch
"@termwright/run-history": patch
"@termwright/run-journal-transport": patch
"@termwright/test": patch
"@termwright/probe-ink": patch
---

Keep the local Native Host profile at two Vitest forks while retaining capacity
for four simultaneous terminals. Worker journal cleanup now drains and closes
its socket on every path, and its close barrier resolves only after the socket
has actually closed, so teardown correctness does not depend on serializing the
monorepo or leaving transport handles for process termination. The Native Host
also drains Vitest's worker pool before advancing its lifecycle, while run
history validates attempt ordering in one pass instead of blocking worker
termination with work proportional to attempts multiplied by journal events.
Persistent-host verdicts are now derived only from the native tasks selected
for the current cycle, so Vitest modules retained from an earlier cycle cannot
contaminate later skip evidence. Explicit partial Vitest catalogues no longer
make unrelated repository-wide required skips appear stale, while every
observed skip still needs one exact declaration. Static Ink probe metadata
checks no longer load the render-session runtime.
