---
'@termwright/ui': patch
'@termwright/test': patch
'termwright': patch
---

Switch completed native test attempts to replay as soon as their retained recording is finalized, including failed attempts and retries. Attempts without a recording continue to report its absence.

Improve the replay timeline with previous/next step controls, millisecond time labels, precise endpoints, keyboard seeking, and aligned markers on small screens. Hover previews now keep the terminal and semantic inspector at the same moment. Selecting and expanding cases preserves navigation state, nested step keyboard navigation stays within the narrative, and crash notices leave player controls reachable.
