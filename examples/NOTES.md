# examples — implementation notes

Why these three suites are shaped the way they are, and what cost time while
writing them. The README says how to use the examples; this file is for whoever
changes them.

Verified against the driver, the preset and all three adapters as of
2026-08-16.

## What these examples are for

They are dogfooding first and documentation second. Every line uses the public
API only — no imports from a package's `src/`, no test hooks in the
applications, nothing that a user installing from npm could not write. When
something here is awkward, that is a finding about the API, not a licence to
reach past it. Three of the fixes that landed before 1.0 started as a
workaround in this directory.

## Deliberate choices

- **The Ink example is built, not run through a loader.** `pretest` runs tsup.
  A user's Ink app is a build artifact too, and a `--import tsx` in the launch
  command would be an example of our test harness rather than of their app.
- **`command` is an absolute path.** Each test gets a fresh temporary working
  directory, so a relative `dist/cli.js` resolves against that directory and
  not against the project. Both configs compute the path from `import.meta.url`.
- **The applications handle their own mouse.** Enabling SGR reporting and hit
  testing the widget under the pointer is the application's job in a terminal,
  and the driver refuses to click a program that has not asked for reports. The
  examples do it the way a real app must, in `ink-todo/src/mouse.ts`.
- **`useMouseReporting` counts its subscribers.** Mouse tracking is a terminal
  mode, not component state. Two components that each enable and disable it
  independently leave it off as soon as the first unmounts — which is exactly
  what a modal does when it closes, taking the rest of the app's clicks with
  it. The refcount is not ceremony; the bug is real and it is silent.
- **Every mouse report returns early, not just the press.** A handler that
  recognises presses and lets everything else fall through types the *release*
  report into the focused text field. This one shipped in the first draft and
  was caught by the filter test.
- **The dialog is a separate component so a component test can mount it.**
  `mountInk` can pass a spy as a prop while still driving the component with
  real bytes; that combination is only available if the component does not
  depend on the app around it.
- **`textual-notes` asserts focus rather than snapshotting its dialog.**
  Textual wraps a `ModalScreen`'s buttons in two layout containers, so a
  `{ within: dialog }` pattern would have to spell them out. Two assertions say
  what the test means — Cancel holds the focus — without pinning the layout.
- **`tview-menu` builds through a script that tolerates a missing toolchain.**
  `scripts/build.mjs` exits 0 with a message when there is no `go`, and the
  suite skips on the missing binary. A JavaScript-only checkout stays green.

## Traps

- **`waitForText` is satisfied by the screen; the tree arrives a beat later.**
  Matchers poll through that gap. Plain reads do not: `expect(app.capabilities()
  .semanticTree).toBe(true)` straight after a text wait fails under load. Put a
  polling matcher first — it is what waits for the handshake — and read the
  capability after it.
- **A spy is not a frame.** Every wait in the harness is driven by rendered
  frames, and a callback that only notifies its parent renders nothing. After a
  physical click, `expect(spy).toHaveBeenCalledOnce()` is a race; `vi.waitFor`
  is not. The example in `@termwright/ink-testing`'s README works only because
  its component re-renders.
- **A click needs the frame to hold still.** Matchers read the tree, but a
  click aims at cell coordinates. Textual fades a modal in, so its buttons
  exist at coordinates that are still moving — `waitForStable()` before the
  click. This is the one wait in these suites that is *not* about the tree, and
  the reason it survives the rest of them being deleted.
- **Renaming a test orphans its stored snapshot.** Wrapping these files in
  `describe(...)` changed every snapshot key; the old entries stayed in the
  files and no update mode removed them. Regenerating from scratch (delete the
  `__snapshots__` YAML, run once) is the way to prune.
- **A stored snapshot is strict, an inline pattern is partial.** Reach for the
  file when any change at all should fail the test, and for a pattern —
  scoped with `{ within: locator }` — when the test is about one behaviour.

## Stability, and the one failure that was real

These suites were soaked before 1.0: 50 consecutive runs of all three examples
in parallel, on a machine deliberately kept at a load average of 180–235, with
`TERMWRIGHT_DEBUG=all` captured for every run and kept for any that failed.
**50 of 50 passed.** Ninety-eight commits landed in the repository while it
ran, so the result covers a moving tree rather than a frozen one.

Two earlier incidents are worth recording, because they look identical from the
outside and had nothing in common.

- **A real product bug, found here first.** Sessions began reporting
  `protocol-violation (malformed): limits: unrecognized key(s):
  maxLogRecordBytes, maxLogQueue`. A new limit key had been added to
  `ProtocolLimits`, and `limits` was validated with a strict schema that the
  Python and Go clients faithfully mirror — so every client built before the
  change rejected the driver's `hello-ack` and the semantic channel died
  silently. The fix made `limits` a tolerant reader in all three clients: known
  keys are still type-checked, unknown ones are ignored. Adding a limit is
  otherwise a breaking wire change for every published client, which is not a
  thing a patch release can do.
- **Two failures that were never explained.** An earlier batch failed 2 runs in
  12 and could not be reproduced in 23 subsequent runs, including under load
  and during a concurrent rebuild of the driver. Their output was not captured
  — the reason this directory now soaks with full capture rather than a bare
  loop. They fell inside the window when the limits change was landing and the
  signature matches, but that is inference, not evidence.

The lesson worth keeping: when one of these suites fails and the screen looks
right, read the diagnostics before suspecting the test. A locator reporting
`matched 0 nodes` against a correctly painted screen means the semantic channel
is gone, not that the selector is wrong.

## Not covered here

- Windows. Nothing in this directory has run on ConPTY.
- `launchInkFixture`. The component tests use `mountInk`; the process-mode half
  of that API is covered by `@termwright/ink-testing`'s own suite.
- The Rust client, which is protocol-only and has no framework adapter to
  demonstrate.
