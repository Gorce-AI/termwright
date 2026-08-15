# @termwright/conformance — implementation notes

Deliberate deviations, findings about other packages, and the traps that cost
time here. Verified against the driver, protocol and Ink adapter as of
2026-08-15.

## Findings in other packages (not fixed here)

1. **A depth-limit breach is reported as `malformed`, not `limit-exceeded`.**
   `parseAdapterMessage` classifies a `dto-depth` violation as `limit-exceeded`,
   but `createFrameDecoder` projects the frame body first (`framing.ts`
   `decodeBody` → `projectDto`), so the violation is thrown out of
   `decoder.push`. The driver's `SemanticChannel` catch-all maps every framing
   fault to `malformed` and keeps the machine-readable code only in the
   suggestion text. An adapter author debugging by error code therefore cannot
   tell a nesting overflow from a syntax error. `too-many-nodes` takes the other
   path and does report `limit-exceeded`, so the taxonomy is inconsistent within
   the same session. Pinned in `adversarial.test.ts` as the current behaviour.

2. **`revision-commit` is accepted and discarded.** `session.ts` installs
   `onCommit: () => {}`; pairing is driven entirely by snapshot + DCS marker. An
   adapter that announces `render-revisions` and sends commits but no marker
   publishes nothing at all, and the only trace is a diagnostic that no public
   API exposes. Correct per §4.3 (the marker is the commit), but the message
   then has no consumer — worth either using it as a fallback commit signal or
   documenting it as advisory.

3. **Channel diagnostics are unreachable.** `TerminalSession` keeps a bounded
   `#diagnosticsLog` of exactly the things a conformance suite wants to assert
   (dropped revisions, superseded halves, unverified markers) and never exposes
   it. Every adversarial assertion here is therefore indirect: the tree stayed
   at revision N, the peer received wire error X. A read-only accessor or a
   `diagnostic` session event would make the failure modes directly testable.

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
