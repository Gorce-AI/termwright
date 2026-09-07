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

Add element picking directly on live and replay terminal screens. Hover highlights recorded semantic bounds; click reveals the element in its tree and opens its details, restoring a hidden inspector on desktop or mobile. Pause playback for selection, support arrows/Enter/Escape, and keep inspection input separate from terminal input. Associate asynchronous tree responses with the requested playhead to reject stale data, including moments between terminal output events.

Drain terminal writes and pending viewport reset callbacks before disposing a replaced emulator, preventing renderer errors during repeated Unicode profile changes.

Improve the remaining Runner workspace workflows: run exact search matches from the catalog, clear searches, and dismiss the New test menu with Escape, outside clicks or keyboard navigation. Distinguish loading, empty and failed history requests; refresh and search retained runs, retain mobile result labels and use consistent outcome colors. Show recording availability once per run.

Add text and explicit severity filters for application logs without inferring severity from plain file messages. Hide live actionability in replay details and report successful or unavailable clipboard writes across inspector fields, diagnostics, source links and generated tests. Share modal focus management with settings confirmations, including Escape cancellation, focus containment and return to the trigger.
