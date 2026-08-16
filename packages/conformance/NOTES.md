# @termwright/conformance — implementation notes

Deliberate deviations, findings about other packages, and the traps that cost
time here. Verified against the driver (f78174f), protocol and Ink adapter as of
2026-08-16.

## Findings reported and fixed

Every finding this package raised is closed. Kept here because the suites that
caught them are the regression tests for them.

Round 1 (driver f78174f):

1. **Wire taxonomy for ceiling breaches** — was `malformed` for anything thrown
   out of the frame decoder, so a nesting overflow was indistinguishable from a
   syntax error. Now an explicit table: `frame-oversized` and `dto-depth` map to
   `limit-exceeded`, structural violations stay `malformed`. Pinned by the
   `REJECTED` table in `adversarial.test.ts`, which covers both sides of the
   split on purpose.
2. **`revision-commit` was discarded** — now advisory *and* recorded, so the
   `tree-without-marker` case asserts directly that the driver saw the
   announcement for revision 4 and still refused to publish it without a marker.
3. **Channel diagnostics were unreachable** — `harness.diagnostics()` and the
   `diagnostic` event landed with a closed `DiagnosticCode` set.

Round 5 (mcp a296dca):

10. **A lost MCP transport leaked a terminal and a session slot.** Streamable
    HTTP never signals that a client vanished, and there was no idle deadline,
    so a crashed agent cost a real PTY *and* a session slot until the server
    exited — repeated crashes exhausted `maxSessions` and locked out new
    agents. `SessionRegistry` now expires idle sessions with a full teardown.
    The suite drives it through an injected clock, because a test that slept
    out a real TTL would be slow and would still pass if the sweeper never ran.

Round 4 (clients 670b60d):

9. **`clients/README.md` documented a state-dependent quit key.** The tview
   table said `q`, which stops working once focus reaches the reason field —
   and the contract suite sends its interaction more than once. The table is now
   measured per framework. The tview registration keeps Ctrl+C, which is
   unconditional.

Round 3 (driver 23c61e5 and aa06a8a):

7. **A refused adapter was not told why.** Every refusal path wrote the error
   frame and called `socket.destroy()` in the same turn, and `destroy()`
   discards unflushed data. Measured on the `second-connection` scenario: the
   peer missed the frame in 2 of 4 full-file runs while the driver's log
   recorded `wireCode` every time. Now the socket is closed only once the frame
   is on its way, with a hard cap so a peer that stops reading cannot hold the
   session open. Every refusal in `adversarial.test.ts` asserts both ends again:
   the code the driver logged, and the code the adapter received.
8. **`wireCode` reached only `protocol-violation` entries** — it now accompanies
   every entry whose path sent a wire error, including the refused late hello
   and the refused second connection.

Round 2 (driver 0e1b0fe, contract note 2d09049):

4. **`waitForReady` called a dead program ready** — fixed; see the liveness
   split below, which is a deliberate distinction and must not be "harmonised"
   away later.
5. **`SessionDiagnostic` carried no machine-readable wire code** — `wireCode?`
   now accompanies `protocol-violation` entries, so the adversarial suite reads
   the taxonomy from the driver instead of from the peer's own output. Both ends
   are still asserted: the driver recorded the code it chose, and the adapter
   received that exact code.
6. **`ready-strategy` conflated a fact with a guess** — replaced by
   `ready-shell-integration` and `ready-settled-screen`. With that, no assertion
   in this package matches diagnostic prose; every one is on a code.

## The liveness split (do not "fix" this)

`waitForText`, `waitForTitle` and `waitForRender` keep succeeding after the
child has exited. `waitForReady` does not. That is not an inconsistency waiting
to be levelled — the two kinds of wait claim different things:

- an **observation** wait asserts something about the past: text that was
  printed stays printed, and a program's death does not retract it;
- a **readiness** wait asserts something about the future — that the program
  will accept input — and a dead program will not honour it. Returning success
  there is a promise the next `press()` breaks with `process-exited`.

`ready.test.ts` pins both halves in one test, so anyone tempted to align them
has to delete an assertion that explains itself.

## Open findings

1. **The Textual example cannot be quit from every focus state.** It binds only
   `q`, and Tab eventually lands on its `Input`, which swallows the key —
   Ctrl+C does not quit either. Measured: `q`, Ctrl+D, Escape+`q` and
   Shift+Tab+`q` all fail once focus reaches the field; only Ctrl+Q (Textual's
   own priority binding) works. The registration uses Ctrl+Q, but the example
   would be better with an explicit priority binding, and `clients/README.md`
   still documents `q`. Same shape as the tview finding closed in 670b60d: a
   user whose test cycles focus and then sends the documented quit key waits
   out a timeout for reasons the app never explains.
2. **Ink can re-render after a resize before `process.stdout.columns` catches
   up.** A component that renders its own size (`size: 60x16`) sometimes keeps
   the old numbers in the frame that already reflects the new layout — measured
   at 2 of 6 resizes, while the republished bounds were correct 6 of 6. A
   component's self-reported size is therefore not a usable signal that a resize
   landed; the layout is. Relevant to `@termwright/ink` and to anyone writing a
   resize assertion.
## Deliberate choices

- **The probe emulates a terminal, and matches text on the rendered grid.** It
  first matched the byte stream, which works only for adapters that write their
  text contiguously — Ink does, tview does not: it positions each run of cells,
  so `focus: reject` never appears as those twelve bytes in a row. Marker
  offsets still read the raw stream, where they belong. Without this, the suite
  would have silently required adapters to draw the way Ink draws.
- **The number of interactions is part of the contract.** The suite sends
  `interaction.input` more than once, so a registration whose quit key only
  works from the starting state fails ten seconds later with no clue why. Both
  facts are now stated in the option's TSDoc rather than assumed.
- **`AdapterProbe` re-implements a minimal driver.** Adapter conformance is
  about wire ordering, which `@termwright/driver` correctly hides. The probe
  parses with the protocol package's own `parseAdapterMessage`, so it validates
  rather than approximates.
- **Cross-stream ordering is not asserted.** The obvious check — "the marker's
  byte offset is past the stdout position recorded when its snapshot arrived" —
  measures event-loop scheduling, not the adapter: the socket callback and the
  PTY data callback are independent, and a later stdout chunk routinely lands
  before an earlier socket message. What is asserted instead is message order on
  the socket (snapshot before commit) and marker order within stdout (strictly
  increasing offsets, non-empty gaps, every MAC verifying).
- **Rule 2 needs no declaration; the others do.** "A container is not named
  from its content" is checkable from the tree alone — both failure shapes
  (taking one descendant's label, and concatenating them all) are visible
  without knowing anything about the fixture, so it runs for every adapter. The
  test-id and empty-textbox rules need a node the registration can point at,
  and the value-derivation gate needs to know which values were author-
  annotated, since an annotation may legitimately put one on any role.
- **A declared deviation is not a failure, and must not look like one.** The
  declarations are read from the adapter's own `## Deviations` section rather
  than repeated in the registration — two copies of the same fact disagree
  eventually, and the README is the copy a user reads. A rule that fails while
  declared is reported as a documented limitation; a rule that fails without one
  is an error. Failing the first would give the author who honestly describes
  their framework a red run for doing exactly what rule 6 asks.
- **"Declared but no longer needed" cannot be derived, only hinted at.** The
  request was for the report to flag a declaration the tests have outgrown. It
  cannot: one rule has more aspects than a subprocess can observe. Ink declares
  a rule 3 limitation about native identifiers while satisfying the annotation
  half of the same rule, and both are true at once — the first version of this
  code called that stale and printed a warning for every adapter, which is a
  false signal on a suite whose whole value is being believed. The summary now
  records "the checks that run for this rule pass" as information, and leaves
  the verdict to whoever re-reads the README.
- **Three shapes for a declaration, all accepted.** `**Rule 2 — …**` (Ink),
  `- **…** (rule 3).` (the language clients) and a markdown table whose first
  cell is `2 — …` (OpenTUI). The suite parses all three rather than making
  authors converge, because the rule it enforces is about adapters, not about
  markdown. Table rows that name no rule are kept under `other`: they are still
  declared limitations, and dropping them would make the roll-up quietly
  incomplete.
- **A section the parser cannot read fails loudly.** Silent under-reporting is
  the worse half of the same coin as crying wolf: an unread declaration makes
  the three-state logic collapse to two, so every documented limitation starts
  reporting as an error against the adapter that took the trouble to declare it.
  The guard is shape-agnostic — a section with structure (bullets, table rows,
  bold lead-ins) that yields no entries is a parser gap — and a section that is
  plain prose saying "nothing to declare" is exempt, because that is a real
  state and failing it would be the same false signal in a new place.
- The README check for rule 6 is advisory on purpose: rules 1, 2 and 4 cannot be
  judged from outside a subprocess, so a missing heading is a documentation gap,
  and failing a conformance run over something no user can observe would train
  people to ignore the run.
- **Delta composition is checked against an oracle, not a self-check.** The
  probe composes with the protocol's own `applyTreeDelta` and compares the
  result against a tree the adapter builds itself in answer to `get-tree`. An
  adapter that composed its own deltas to validate them would only prove it
  agrees with itself; the disagreement worth catching is between producer and
  receiver.
- **Deltas need their own session.** An adapter only sends them to a driver that
  asked (`subscribe: 'diffs'`), so the delta obligation opens a second probe.
  The shared session keeps subscribing to whole trees, which is the path most
  adapters use and which the other obligations exercise.
- **The adversarial peer imports nothing from termwright.** It re-derives the
  4-byte length prefix and the marker MAC from the spec text. Using
  `encodeFrame`/`encodeMarker` would only prove the implementation agrees with
  itself.
- **Fixtures are `.mjs` with `React.createElement`, not JSX.** They must run as
  `node <fixture>` from any suite and any language binding's CI, with no build
  step in front of them.
- **The semantic fixture hit-tests its own layout.** Clicks are resolved against
  bounds the fixture measured with `measureElement`, so a passing hit-test proves
  the driver aimed at the cell the *application* believes the widget occupies.
  Asserting "something changed" would pass on an off-by-one.
- **The suites run under `envMode: 'replace'`.** The session pool passes no
  `env` at all, so every suite exercises the secret-safe default a user gets.
  Forwarding the runner's environment (which is what the pool did before the
  option existed) would quietly turn every suite into an `'inherit'` test and
  leave the default uncovered. `ready.test.ts` covers both modes explicitly.
- **Survival is judged by the exit status, not by screen content.** The
  adversarial suite's `expectSurvives` presses `q` and asserts the exit code.
  Asserting on the screen would depend on where the peer's output happened to
  be: under a flood the banner has scrolled off the grid, and the newest line
  races the exit it announces. Each test asserts on the tree or the screen
  before it gets there, where the content is stable.
- **`runAdapterConformance` is async.** `vitest` is imported dynamically so the
  package remains importable from a plain script that only wants fixture paths
  or the probe. Callers `await` it at the top level of the test file.

## Traps

- **A PTY coalesces writes.** Two `press()` calls routinely arrive as one chunk.
  Both interactive fixtures tokenise the chunk (escape sequences whole, then one
  code point at a time); treating a chunk as one event silently drops the second
  key and makes every multi-key test flaky rather than failing.
- **The tree lags the screen by design.** The marker follows the frame, so a
  `waitForText` on rendered output can precede the matching semantic revision by
  a beat. State assertions right after a rendered change use `expect.poll`.
- **`AdapterProbe.waitForText` reads the grid; `observation.text` is cumulative.**
  The two are different views of the same session and are easy to confuse. The
  grid is what a user sees and is what waits match against. The raw text is
  everything ever written, so anything printed once matches it forever —
  which is why proving an app is *still* rendering uses growth in its length,
  never a text match.
- **If an assertion counts occurrences, the wait before it must not be
  satisfiable by the first one.** The double-click test counted `MOUSE press`
  lines on a screen snapshot taken after waiting for the release. When the pair
  arrived as two chunks — which a loaded machine does regularly — the wait was
  already satisfied by the first pair and the count found one press. The fixture
  now decides what a double click is and reports it as a single unambiguous
  event, so the test waits for something that exists exactly once.

  This is a different failure from the scroll-off trap below, and the pair is
  worth holding side by side: that one is *asserting on something that can
  disappear*, this one is *waiting for something that arrives twice*. Both look
  like flakiness and neither is — the test was wrong, and the machine's timing
  only decided when it would say so.
- **Run vitest as a script, not as a shim or through `npx`.** Two ways this
  broke. `npx vitest` downloads the latest release when the local binary is not
  on its lookup path, so a workspace change elsewhere turned `pnpm conformance`
  into a run against a different major. Then `node_modules/.bin/vitest` — the
  obvious fix — is a shell script on POSIX and a `.CMD` shim on Windows, where
  spawning it without a shell is ENOENT, which is how the first real Windows CI
  run failed. The script now reads the `bin` entry out of vitest's own
  `package.json` and runs that file with `process.execPath`: no download, no
  shim, no platform branch.
- **A runner whose output is discarded cannot be diagnosed from CI.** The
  matrix used to spawn vitest with stdout ignored, so a failing suite printed
  tallies and nothing else — the first CI failure said `FAIL (1)` with no way to
  tell which assertion, and had to be reproduced locally. The output is captured
  now and printed whenever a run exits non-zero.
- **Cross-stream arrival order is not the contract.** The ordering obligation
  compared markers against the snapshots observed at that instant, and a marker
  read off stdout can precede the socket frame for the same revision — the same
  independence documented under Deliberate choices. It now waits until every
  observed marker has its snapshot and commit, which is what "each revision has
  all three parts" actually means.
- **The generic fixture's frame is 14 rows tall.** A suite that asks for fewer
  (the scrollback test uses 10) pushes the top of the frame off the grid as the
  rest of it is drawn, so waiting for the banner is waiting for something that
  may already be gone — deterministically gone when the pty delivers the frame
  in one write, and intermittently gone otherwise. Both helpers wait for
  `allow: PATH=`, the last line the fixture draws, which is visible at any
  height and also proves the whole frame landed.
- **Text that can scroll off is not a safe thing to wait for.** A pseudo-
  terminal may deliver a program's whole output in one chunk, so a `waitForText`
  on an early line passes or fails depending on how the write was split. Every
  wait here targets either the newest line or a full-frame repaint; the
  scrollback test waits on `SCROLL DONE`, which the fixture prints last on
  purpose.
- **`waitForReady` can return before the command it should wait for starts.**
  Between `press('Enter')` and the shell's `OSC 133 C`, the last mark still says
  "prompt waiting", so a `waitForReady` issued immediately after a keystroke
  resolves against the *previous* prompt. The prompt fixture prints
  `RUNNING <command>` at command start so the suite can wait for the command to
  be observably running first; a user hits the same race and needs the same
  answer.
- **A ZWJ cluster's width is disputed.** Yoga (Ink) and `@xterm/addon-unicode11`
  disagree on `👩‍👩‍👧`, which shifts every row below it inside a bordered box.
  The semantic fixture keeps the sequence in a plain row where the disagreement
  is observable but harmless; putting it in the modal broke the dialog's own
  bounds and, with them, hit-testing.

## Not covered yet

- Windows/ConPTY: nothing here has been run on Windows. The suites skip cleanly
  where no PTY opens, which is not the same as passing.
- Log *bridges*: `@termwright/logs` ships pino, consola and OTel adapters;
  conformance exercises the wire contract (`seq`, budgets, ceilings, records
  staying off-screen) but not the bridges themselves, which have their own
  tests.
- MCP session *recovery*: `mcp-sessions.test.ts` covers isolation, close
  ownership, the ceiling and cursor independence, but not resuming a session
  from a new transport (the SDK supports it; nothing in this project relies on
  it yet).
- The in-process half of §20.2a lives in `@termwright/ink-testing`; this package
  ships the shared component and the process-mode expectations it is compared
  against.
