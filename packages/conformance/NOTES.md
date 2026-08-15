# @termwright/conformance — implementation notes

Deliberate deviations, findings about other packages, and the traps that cost
time here. Verified against the driver (f78174f), protocol and Ink adapter as of
2026-08-16.

## Findings reported and fixed (driver f78174f)

All three findings this package raised in its first round are closed. Kept here
because the suites that caught them are still the regression tests for them.

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
   `diagnostic` event landed with a closed `DiagnosticCode` set. Every
   adversarial assertion that used to be indirect is now direct: superseded and
   expired revisions, evictions under flood, unverified markers, negotiation
   timeout, adapter attach/disconnect.

## Open findings

1. **`waitForReady` resolves for a program that has exited.** When the last
   OSC 133 mark says a prompt is waiting and the process then exits,
   `waitForReady` returns ready, while `waitForText` on the same session throws
   `process-exited`. The other waits call `#assertAlive` before their deadline
   check; `waitForReady` reaches its ready branch first. Pinned as observed in
   `ready.test.ts` ("still reports readiness from the last prompt of an exited
   program") with a note that the expectation flips when the waits align.
2. **`SessionDiagnostic` carries no machine-readable wire code.** A
   `protocol-violation` entry has the human explanation in `detail`, so a suite
   asserting *which* wire error closed the channel still has to read it off the
   adapter's own output. An optional `wireCode` field would close the last
   indirect assertion in the adversarial suite. Minor: the taxonomy itself is
   now correct and is asserted at the peer.

## Deliberate choices

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
- **`runAdapterConformance` is async.** `vitest` is imported dynamically so the
  package remains importable from a plain script that only wants fixture paths
  or the probe. Callers `await` it at the top level of the test file.

## Traps

- **A PTY coalesces writes.** Two `press()` calls routinely arrive as one chunk.
  Both interactive fixtures tokenise the chunk (escape sequences whole, then one
  code point at a time); treating a chunk as one event silently drops the second
  key and makes every multi-key test flaky rather than failing.
- **`waitForText` returns on the first line of a frame, not the last.** The
  generic suites wait for the event log (the last row the fixture draws) before
  asserting on coordinates, or half the screen is still in flight.
- **The tree lags the screen by design.** The marker follows the frame, so a
  `waitForText` on rendered output can precede the matching semantic revision by
  a beat. State assertions right after a rendered change use `expect.poll`.
- **`AdapterProbe.waitForText` sees cumulative output**, not a rendered screen:
  anything the app printed once matches forever. Proving that an app is *still*
  rendering uses growth in output length, not a text match.
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
- Concurrent MCP sessions (§20.4, last item): only concurrent *driver* sessions
  are covered; the MCP layer has its own ownership rules to certify.
- The in-process half of §20.2a lives in `@termwright/ink-testing`; this package
  ships the shared component and the process-mode expectations it is compared
  against.
