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

1. **A lost MCP transport leaks a terminal and a session slot.** Streamable HTTP
   gives the server no signal when a client stops talking, and there is no idle
   deadline, so a session whose client crashed stays registered forever and its
   child process keeps running. Measured: after `client.close()` the registry
   still holds the session and the pid is alive 5 s later; only `serveHttp`'s
   own `close()` reclaims them. Two consequences, the second worse than the
   first: a crashed agent leaks a real PTY per crash, and because the slot is
   never freed, repeated crashes exhaust `maxSessions` and lock out new agents —
   an accidental denial of service. A session TTL (close a session with no
   request for N minutes) would bound it the way everything else in this project
   is bounded. Pinned as observed in `mcp-sessions.test.ts`.
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
- **The report script must use the workspace's vitest, never `npx vitest`.**
  `npx` downloads the latest release when the local binary is not on its lookup
  path, so a workspace change elsewhere in the repo turned `pnpm conformance`
  into a run against a different vitest major — reported as a startup crash and
  read at first glance as a conformance failure. `scripts/conformance.mjs`
  resolves `node_modules/.bin/vitest` explicitly and fails loudly if it is
  missing.
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
- MCP session *recovery*: `mcp-sessions.test.ts` covers isolation, close
  ownership, the ceiling and cursor independence, but not resuming a session
  from a new transport (the SDK supports it; nothing in this project relies on
  it yet).
- The in-process half of §20.2a lives in `@termwright/ink-testing`; this package
  ships the shared component and the process-mode expectations it is compared
  against.
