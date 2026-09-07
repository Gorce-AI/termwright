---
'@termwright/ui': patch
'@termwright/test': patch
'termwright': patch
---

Switch completed native test attempts to replay as soon as their retained recording is finalized, including failed attempts and retries. Attempts without a recording continue to report its absence.

Improve the replay timeline with previous/next step controls, millisecond time labels, precise endpoints, keyboard seeking, and aligned markers on small screens. Hover previews now keep the terminal and semantic inspector at the same moment. Selecting cases preserves replay position, nested step keyboard navigation stays within the narrative, and crash notices leave player controls reachable.

Separate the searchable test list from the selected test's independently scrolling steps. Filter failed tests, read full step titles, and expand successful Gherkin commands on demand. Failures surface above the narrative with a direct jump to the failing command and its complete error; retry and technical details remain available without crowding the overview. Progress counts named steps once, and selecting a test again preserves its playhead and details.
