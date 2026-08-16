# @termwright/driver — implementation notes

## Windows: why the child died with exit code 134

First Windows CI run: every PTY test failed with `the program exited with code
134`, alongside a flood of `Error: AttachConsole failed`. Those are two separate
things, and the loud one is not the one that broke the tests.

**The failure was ours.** `envMode: 'replace'` — the secret-safe default — used a
POSIX-shaped allowlist (`PATH`, `HOME`, `LANG`, …). A Node process started
without `SystemRoot` on Windows does not report an error, it **aborts**: exit
code 134, no message, nothing on the screen to wait for. Every fixture died the
instant it started. The allowlist is now platform-aware, and `env.test.ts`
asserts on each platform that the variables a child needs to start survive the
replacement — so Windows checks the Windows branch instead of a comment
promising it works.

Windows environment names are case-insensitive and the OS chooses the casing, so
the allowlist is matched against the real keys rather than read by an assumed
spelling.

## Windows: the AttachConsole noise is teardown, not spawn

`Error: AttachConsole failed` is thrown at `conpty_console_list_agent.js:11`,
inside a process `@lydell/node-pty` **forks** from `kill()` to enumerate the
console process list. A GitHub Actions runner's session has no console to
attach to, so it throws there every time a session closes.

Worth recording because the obvious diagnosis is wrong twice over:

- **There is no winpty fallback to escape.** `WindowsPtyAgent` in
  `@lydell/node-pty` 1.1.0 unconditionally `require`s `conpty.node` and calls
  `conptyNative.startProcess`. The package is ConPTY-only; nothing chooses
  between backends.
- **There is no `useConpty` to force.** Neither the typings nor the JavaScript
  mention it — the only Windows option is `conptyInheritCursor`. Passing
  `useConpty: true` would be a no-op that looks like a fix.

The parent tolerates the throw: it waits for the agent's message and falls back
to the shell pid after a 5 s timeout. That makes it a slowness risk on Windows
rather than a correctness one — if teardown turns out to cost seconds per
session there, the fix is to stop routing Windows teardown through
`pty.kill()`, and that needs a Windows run to justify rather than a guess.

## Windows: the mouse mode is hidden, not absent

ConPTY is an emulator sitting between the child and the driver, so it consumes
the child's `CSI ? 1000/1002/1006 h` instead of forwarding it — measured by the
permeability probe in `escapes.pty.test.ts`, which also found DCS, APC and
OSC 8 dropped while private OSC (either terminator) and OSC 133 pass. That is
why the render marker rides OSC 8487.

The mouse needed a different answer, because a second probe measured the other
direction: a child whose DECSET was swallowed **still decodes a report the
driver writes**. The driver is blind, not powerless. So `mouseTracking` and
`mouseEncoding` report `'unknown'` where the platform hides them, pointer
actions refuse only on a mode known to be off, input is sent in SGR, and the
session records `mouse-mode-unverifiable` once.

`'unknown'` is not revised by a request that does arrive: that would prove only
that one arrived, and treating it as proof about the rest would report a
partial view as a complete one. If ConPTY ever starts forwarding these, the
probe table says so and the default flips deliberately.

`mouseModesObservable` on `launchTerminal` forces the verdict, so the Windows
path is exercised on every platform — a behaviour only one OS reaches is a
behaviour only one OS tests.
