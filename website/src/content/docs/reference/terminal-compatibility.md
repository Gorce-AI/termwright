---
title: Terminal compatibility
description: Supported terminal escape sequences, input modes, observable state, platform differences, and Unicode limits.
---

Termwright runs the application in a real PTY and renders its output with the
shared headless terminal emulator. “Real PTY” does not mean that Termwright
emulates every feature of Kitty, iTerm2, or another terminal application.

## Terminal feature matrix

| Feature                               | Rendered or delivered | Assertable           | Notes                                                         |
| ------------------------------------- | --------------------- | -------------------- | ------------------------------------------------------------- |
| Normal and alternate screen           | Yes                   | Yes                  | `screen().buffer` identifies the active buffer.               |
| ANSI/SGR color and attributes         | Yes                   | Yes                  | Available per cell and in cell snapshots.                     |
| Cursor position and visibility        | Yes                   | Yes                  | Position is part of `screen()` and `shell.status()`.          |
| DECSCUSR cursor shape                 | Yes                   | Yes                  | Block, underline, and bar shapes are exposed when set.        |
| Terminal title (OSC 0/2)              | Yes                   | Yes                  | Use `title()`, `waitForTitle()`, or `shell.status()`.         |
| Bell                                  | Yes                   | Yes                  | Counted by `shell.status()`; audio is not played.             |
| OSC 8 hyperlinks                      | Yes                   | Yes                  | URI and retained `id` are available on cells.                 |
| Bracketed paste                       | Yes                   | Yes                  | `paste()` follows the mode enabled by the child.              |
| Application cursor keys               | Yes                   | Yes                  | Arrow-key bytes follow the active mode.                       |
| SGR mouse                             | Yes                   | Yes where observable | Pointer actions additionally require exact target ownership.  |
| Focus in/out reports                  | Yes                   | Yes where observable | Mode state is `unknown` where the host hides it.              |
| Synchronized output                   | Yes                   | Yes                  | Render revisions settle after the synchronized block.         |
| OSC 7 working directory               | No visible output     | Yes                  | Exposed through `shell.status()`.                             |
| OSC 133 shell integration             | No visible output     | Yes                  | Enables exact prompts, command output, and exit codes.        |
| OSC 52 clipboard                      | Not exposed           | No                   | Tests should not depend on the host clipboard.                |
| Kitty keyboard protocol               | No                    | No                   | Use the documented key encodings and standard terminal modes. |
| Sixel / Kitty graphics / iTerm images | No                    | No                   | Image payloads are not rendered into cells.                   |

## Platform observations

Certified PTY backends, including pinned passthrough ConPTY, expose mouse and
focus mode changes to Termwright. `unknown` is reserved for an embedding that
explicitly cannot prove what the child requested; it is never converted into a
positive or negative fact.

Run `termwright doctor` on the target host and keep OS coverage in the CI
matrix. The repository's PTY conformance suite exercises escape transport on
supported CI platforms.

## Character width

Terminal profiles select deterministic width and resize behavior. They do not
emulate the terminal application named by the profile. See [Terminal
profiles](../../guides/terminal-profiles/) for the current Unicode and grapheme
limits.
