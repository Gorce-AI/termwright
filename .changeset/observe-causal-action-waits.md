---
'@termwright/driver': patch
---

Expose locator retry waits through a structured `action-observation-wait`
diagnostic. Its `actionId` correlates the wait with the action lifecycle, while
`observationState` identifies the exact in-flight parser, semantic-frame, or
render-pairing boundary that must settle before input can be sent.
