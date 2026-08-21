---
title: "Type Alias: EnvMode"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EnvMode

# Type Alias: EnvMode

> **EnvMode** = `"inherit"` \| `"replace"`

Defined in: [api.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L62)

How the child's environment is built.

- `'replace'` (default, secret-safe): only a documented allowlist of
  variables the child genuinely needs (PATH, HOME, LANG, LC_ALL, SHELL,
  TMPDIR, USER on POSIX; the longer Windows list adds SystemRoot, PATHEXT
  and the profile variables) plus everything in [LaunchOptions.env](../../interfaces/launchoptions/#env);
- `'inherit'`: the parent's full environment, plus [LaunchOptions.env](../../interfaces/launchoptions/#env).

The termwright handshake variables are injected in both modes.

`TERM` and `COLORTERM` are **set by the driver in both modes**, to
`xterm-256color` and `truecolor`, and are not inherited: the child's
terminal is this driver's emulator, whose capabilities are known exactly,
so passing on whatever terminal launched the test run would describe
something the child is not attached to — and passing on nothing (a Windows
runner has no `TERM` of its own) leaves ncurses-style libraries guessing.
An explicit entry in [LaunchOptions.env](../../interfaces/launchoptions/#env) still wins, for a caller
testing how their program behaves under a different `TERM`.
