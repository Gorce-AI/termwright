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
