# @termwright/ink-testing — implementation notes

What this package learned about standing in for a pseudo-terminal, and the
deliberate differences that remain. Verified against Ink 7.1.1, React 19.2,
`@termwright/driver` 0.1.0 and `@termwright/ink` 0.1.0.

## Two findings that cost real time

### Ink writes its first frame *inside* `spawn()`

`launchTerminal` spawns the child and subscribes to its output on the next
statement. For a real pty that gap is harmless — bytes wait in a kernel buffer.
For an in-process mount it is fatal: `semanticRender` is synchronous, and by the
time `spawn()` returns, Ink has already written the alternate-screen enter, the
hidden cursor, the first paint, and everything the mount effects emitted. All of
it went to a listener set that was still empty, and the session saw an
application that rendered nothing while the semantic tree looked perfect —
`getByRole` found the button, `screen()` was blank.

`InProcessPty` therefore buffers output until the first `onData` subscription
and flushes it then, bounded at 4 MiB. This is the pty buffer, reimplemented,
and it is not optional.

### A pty's line discipline is part of the contract

Ink separates rows with a bare `\n` and relies on the kernel's `ONLCR` to turn
it into `\r\n`. Without it the second row starts under the end of the first and
the frame staircases — which looks exactly like a component bug, not a harness
bug. `applyOnlcr` in `src/streams.ts` reproduces the translation byte for byte,
including the unconditional case (`\r\n` becomes `\r\r\n`, which is what the
kernel does and what a terminal ignores).

Only the *output* half is emulated. Input is delivered verbatim, which
corresponds to a tty in raw mode — no `ICRNL`, no `ECHO`, no `ISIG`. Every Ink
app enables raw mode as soon as it takes input, so this matches; a component
that deliberately reads cooked input belongs in `launchInkFixture`.

## Documented differences between the two modes

`src/parity.test.ts` asserts that the semantic trees, the bounds and the screen
text are *identical* for the same component at the same size, before and after a
click. What is not identical:

- **Session identity.** `sessionId`, node id numbering and revision counters are
  per-session by construction.
- **`process`.** A mount shares the runner's process: `process.env`,
  `process.pid`, `process.stdin.isRaw` and `process.argv` belong to the test
  runner, not to the component. `PtyProcess.pid` reports the runner's pid rather
  than inventing one.
- **Signals.** In-process there is nothing to signal, so `signal()` unmounts the
  app and reports the status the signal would have produced
  (`{code: null, signal: 'SIGINT'}`). A component with its own `SIGINT` handler
  will not see it. Fixtures deliver the real thing.
- **`envMode`.** Both modes accept it and both pass it to `launchTerminal`, but
  it means different things. A fixture is a separate process, so `'replace'`
  (the driver's default) is real isolation — its `process.env` is exactly the
  allowlist plus `env`. A mount shares the runner's process and never mutates
  `process.env`, so the component reads the runner's environment regardless;
  `envMode` shapes only what the *adapter* is handed. `src/env-mode.test.tsx`
  asserts both directions, including that a fixture with `'inherit'` does see
  the runner's variables.
- **`crashReport()`.** Forwarded by both, but only a fixture can ever return
  one. A crash is a process dying unasked; a mount shares the runner's process
  and every way it ends — `close()`, `signal()`, the app unmounting itself — is
  either requested or clean. `src/crash-report.test.tsx` pins both halves,
  including a fixture that throws out of a timer on input and the report that
  comes back with the stack in `screenTail` and the keystroke in
  `recentInputs`.
- **Console capture.** The adapter wraps `console.*` into log records whenever
  it is instrumented, and that default is right for a process of its own. A
  mount turns it **off**: the console object belongs to Vitest and to every
  other test in the file, so capturing it would file the runner's output under
  the component and would leave a wrapper on a global for the mount's lifetime.
  `mountInk({captureConsole: true})` opts back in — the adapter restores the
  originals on unmount, which `src/logs.test.tsx` pins in both directions.
  Console output that is genuinely the subject of a test belongs in a fixture.
- **Props.** A mount takes anything React takes; a fixture takes bounded JSON.
  `assertJsonProps` refuses functions, `undefined`, cycles, class instances and
  depth over 8 *before* spawning, because `JSON.stringify` would drop them
  silently and the failure would surface as a prop that is mysteriously absent.

## Deliberate design choices

- **`patchConsole: false` by default.** Ink's default patches the global
  `console` for the lifetime of the app. In a test runner that is a
  process-wide side effect leaking across test files; a mount that leaves no
  trace is worth more here than fidelity to Ink's default.
- **`maxFps: 1000`.** Not for speed — for the gap. At Ink's default of 30 fps a
  single update can be split across a 33 ms throttle, which is wider than
  `waitForStable`'s quiet window, so a wait can return between two frames of one
  update. Raising the cap closes the gap without changing what is rendered.
- **`debug` is not exposed.** It makes Ink append every frame instead of
  repainting, turning the screen model into a transcript and breaking every
  coordinate-based locator. `incrementalRendering`, `concurrent`, `exitOnCtrlC`,
  `patchConsole`, `maxFps` and `isScreenReaderEnabled` are exposed; `stdout`,
  `stdin`, `interactive`, `alternateScreen` and `onRender` belong to the
  harness.
- **`interactive: true` + `alternateScreen: true` are forced.** That is the only
  configuration in which the adapter claims `absolute-bounds` (see the adapter's
  NOTES), and without absolute bounds a click cannot be aimed.
- **The harness is forwarded explicitly, not proxied.** `ForwardingHarness` in
  `src/forwarding.ts` names every member of `TerminalHarness`, and both modes
  extend it. A `Proxy` would be shorter and would keep compiling when the
  contract grows — the explicit list has now caught four additions
  (`locatorForRef`, `waitForReady`, `diagnostics`, `crashReport`).

  `Object.create(session)` is worse than shorter: it *typechecks* and then
  throws on the first call, because the driver's session keeps its state in
  private fields, which are unreachable from an object that merely inherits
  from it (`Cannot read private member #closed from an object whose class did
  not declare it`). The fixture wrapper was written that way first and the type
  system had nothing to say about it.
- **`waitUntilExit()` is called exactly once per mount.** It registers a
  `beforeExit` listener that Ink only removes from inside `unmount()`, so
  calling it again after unmounting leaks one listener per mount — enough to
  trip Node's warning within a single test file.
- **An error boundary wraps every mounted tree.** Without it a component that
  throws during render rejects a promise nobody is awaiting, and the test fails
  as a timeout on the next locator. The boundary renders `null` rather than a
  fallback message, so the failed frame cannot be matched by a text locator, and
  it is keyed by a generation counter so `rerender` gets a fresh boundary.
- **Fixtures are argv-driven, not env-driven.** The payload is one JSON argument
  capped at 64 KiB; the runner re-validates it from scratch and refuses anything
  that is not a `file:` URL. It never evaluates a string.

## "First frame" means painted *and* described

`waitForFirstFrame` waits for two independent facts, because neither implies
the other and under load they arrive in either order. The adapter's first tree
is a socket round-trip and can beat Ink's first frame through the pty; the
paint can equally land with the tree still in flight. Settling on one alone
hands back a harness that is either blank or unaddressable, and both failures
read as a broken component rather than a harness that returned too early.

The tree half was originally a grace period of our own — wait up to a second
for a tree, then carry on. That held on an idle machine and quietly degraded to
"no tree" on a loaded one, which is how `parity.test.ts` came to read
`semanticTree() === null` in a full run. The fix was to delete the guess:
`harness.settled()` is the session's own verdict, waiting out the negotiation
and, for a session whose adapter attached, for the first tree to be paired,
while resolving immediately as generic when no adapter can still join. The
session always knew; it just had no way to say so until `settled()` landed.

The lesson generalises: when this package finds itself estimating how long
something in the driver takes, the estimate is the bug.

## Gotchas for future maintainers

- **A fixture component must keep the event loop alive.** `env-app.mjs` was
  written without `useInput` at first and every launch failed with
  `process-exited` (code 0): nothing referenced the loop, Node drained it, and
  Ink unmounted on its own `beforeExit` handler before the harness saw a frame.
  The `died` race in `fixture.ts` is what turns that into a legible failure
  instead of a settle timeout. Any interactive component is fine; a static one
  needs something holding the loop.
- **`NODE_OPTIONS` does not reach a fixture** under the driver's `'replace'`
  default — the allowlist is `PATH`, `HOME`, `LANG`, `LC_ALL`, `SHELL`,
  `TMPDIR`, `USER`, `TERM`. Nothing here needs it (the runner is spawned with
  an absolute path and resolves its imports by directory walk), but a user whose
  TypeScript loader is configured through `NODE_OPTIONS` will find it silently
  dropped. `nodeArgs` is the answer, and the README says so.
- `waitForText` is a screen wait. The tree for that frame lands immediately
  afterwards, so an assertion on `semanticState()`/`value` right after a text
  wait needs a `waitForStable()` between them. This is driver semantics, not a
  bug, and it is documented in the README.
- `src/testing/counter-app.mjs` is plain JavaScript with `createElement` on
  purpose: it is imported by the in-process tests *and* by a fixture process
  running under a bare `node`. Parity is only worth asserting if both modes run
  the same file. Its types live in `counter-app.d.mts`.
- The component hit-tests mouse reports with `measureElement`, whose coordinates
  are relative to Ink's live layout region. That equals the viewport only under
  interactive + alternate screen — the same premise the adapter's
  `absolute-bounds` claim rests on.
- Ink hands unrecognised escape sequences to `useInput` with the leading `ESC`
  stripped, so an SGR mouse report arrives as `[<0;12;3M`. The component's regex
  makes the `ESC` optional for that reason.
- Mounting twice on one `createInProcessBackend` is refused: Ink keys its
  instances by stdout stream, and a second app on the same wires is not
  something it supports.

## The preset test (`src/preset.test.tsx`)

`@termwright/test` is a **dev-only** dependency here; nothing in `src/index.ts`
imports it and the runtime dependency graph in CONTRACTS is unchanged. It exists
because a mount is the only way to exercise the preset's matchers where no
pseudo-terminal is available — a sandboxed container, a Windows runner without
ConPTY, a machine where the native pty binding failed to build. Every other
preset test needs a real pty.

It works without any adaptation: the matchers duck-type on `screen()` and
`semanticTree()`, which is exactly what `mountInk` returns, and the preset's
`termwright` fixture is `auto: true`, so snapshot scoping is wired up by
importing `test` from the preset rather than from Vitest.

The stored snapshots in `src/__snapshots__/` are assertions, not artifacts —
review them like source.

## The fixture control channel

`launchInkFixture(...).rerender(props)` needs to reach another process, and the
tempting route — writing to the fixture's stdin — is the one thing it must not
do. Stdin is the simulated *user*: multiplexing commands onto it would mean
every keystroke test depends on nobody typing the framing the harness chose.

So the harness opens a second, private endpoint, shaped exactly like the
driver's semantic channel: unix socket in a `mkdtemp` directory (named pipe on
Windows), address and a 256-bit token in the child's environment, harness
listens and fixture connects. Newline-delimited JSON, 64 KiB per message, one
connection accepted at a time — before authentication as much as after, because
two unauthenticated peers sharing one line buffer could split each other's
messages.

Two properties worth keeping:

- **The component is fixed at startup.** A control message carries props and
  nothing else; the module and export were resolved once, from the launch
  payload. A confused or hostile channel can change what a component shows,
  never which code runs.
- **Listen first, send second, let a failed send win.** `rerender` attaches the
  frame listeners before it writes, so a fixture that repaints immediately
  cannot outrun them — but it awaits the command's acknowledgement *before*
  awaiting the frame, so a rejected command (unserializable props, oversized
  message, a fixture that refused) fails in milliseconds instead of waiting out
  a frame that will never come. Writing it the other way round cost three
  timeouts.

## Open threads

- Windows is untested. `@lydell/node-pty` covers the fixture path and the
  in-process path has no platform surface at all, but neither has been exercised
  on a ConPTY host.
- The control channel carries one command. `rerender` is the only thing a test
  has needed so far; unmount-on-demand or a props *patch* would fit the same
  framing if a use case turns up.
- There is no `mountOpenTui`. The backend, the streams and the settlement
  helpers are framework-agnostic and exported for exactly that reason; only
  `mount.tsx` knows about Ink.
