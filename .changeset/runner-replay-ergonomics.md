---
'@termwright/ui': patch
'@termwright/test': patch
'@termwright/trace': patch
'termwright': patch
---

Switch completed native test attempts to replay as soon as their retained recording is finalized, including failed attempts and retries. Attempts without a recording continue to report its absence.

Improve the replay timeline with previous/next step controls, millisecond time labels, precise endpoints, keyboard seeking, and aligned markers on small screens. Hover previews now keep the terminal and semantic inspector at the same moment. Selecting cases preserves replay position, nested step keyboard navigation stays within the narrative, and crash notices leave player controls reachable.

Group the searchable test list by source file, with compact single-line test titles and the selected test's steps expanded directly underneath its row. Show each file name once per group and avoid repeating the test title in its details. Filter failed tests, read full step titles, and expand successful Gherkin commands on demand. Failures surface above the narrative with a direct jump to the failing command and its complete error; retry and technical details remain available without crowding the overview. Progress counts named steps once, and collapsing a test preserves its playhead.

Keep collapsed step rows on one line, with their source location and action/assertion counts available in a pointer- and keyboard-accessible tooltip instead of a separate metadata row.

Record ordinary Jest-style expectations as assertion rows alongside terminal matchers, in live sessions and retained traces. Preserve negation, promise and soft outcomes, collapse polling into its final result, and retain locator evidence without duplicate rows. Add retrying `toHaveCount`, with an explicit explanation for empty or non-unique matches. Assertion targets can be previewed and pinned; primitive comparisons do not invent selectors. Explain missing evidence in older recordings.

Move collapsed panel handles to their own workspace edges and move terminal expansion into a quiet icon in the terminal toolbar. Keep layout controls separate from the test outcome. Escape restores the previous panel layout; compact screens use their workspace tabs without duplicate layout controls.
