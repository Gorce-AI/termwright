---
title: Test commands in an integrated shell
description: Run commands with exact output boundaries, exit codes, working directories, and prompt state.
---

Use `terminal.shell` when a test drives several commands in one interactive
shell and needs the result of each command separately.

```ts
import {expect, test} from 'termwright/test';

test('builds the workspace', async ({terminal}) => {
  const shell = await terminal.openShell({
    cwd: '/workspace/project',
  });

  const build = await shell.shell.run('npm run build');

  expect(build.exitCode).toBe(0);
  expect(build.output).toContain('built successfully');
  expect(build.cwd).toBe('/workspace/project');
  expect(build.receipt.outcome).toBe('completed');
});
```

`openShell()` starts PowerShell on Windows and `$SHELL -i` (or `/bin/sh -i`) on
POSIX systems. It adds exact OSC 133 command boundaries in both modes. Pass
`shell` to choose another compatible shell command. Termwright does not identify
prompts by matching their text. Managed PowerShell commands accept only the
composable startup switches `-NoLogo`, `-NoProfile`, `-NoExit`,
`-ExecutionPolicy <value>`, and `-WorkingDirectory <value>`; script and command
modes are rejected because Termwright owns the startup command that publishes
the initial boundary.

## Choose the command API

| Need | Recommended approach |
| --- | --- |
| Test one CLI invocation | Launch the CLI directly and use `waitForExit()`. |
| Run several commands in one shell | Use `terminal.openShell()` and `shell.run()`. |
| Drive an interactive prompt or full-screen TUI | Use terminal input, locators, and assertions. |
| Use a shell without OSC 133 integration | Drive it with `press()` and `type()`; command boundaries are unavailable. |

## Inspect shell state

```ts
const status = shell.shell.status();

expect(status.ready).toBe(true);
expect(status.cwd).toBe('/workspace/project');
expect(status.title).toBe('project — zsh');
expect(status.cursor).toMatchObject({row: 4, column: 2});
expect(status.bellCount).toBe(0);
```

`status()` reports only terminal control sequences observed in the session:

- OSC 133 provides prompt readiness, command boundaries, and exit codes;
- OSC 7 provides the working directory;
- OSC 0/2 provides the terminal title;
- terminal state provides the cursor and bell count.

Missing facts remain `null` or unsupported. A session created with
`terminal.launch()` can also use this API when its child publishes OSC 133 and
OSC 7 itself. Otherwise `waitForPrompt()` and `run()` throw
`CapabilityUnavailableError`.

## Command output

`run()` captures the exact text emitted between the command-start and
command-finished marks. It excludes the prompt and the command echo emitted
before the start mark. `maxOutputBytes` bounds the captured result:

```ts
const result = await shell.shell.run('npm test', {
  timeout: 60_000,
  maxOutputBytes: 16 * 1024 * 1024,
});
```

Only one `run()` may be active per terminal session. Use separate sessions for
concurrent commands.

The returned `receipt` uses the same action model as locator and raw-device
actions. It records the committed observation before and after submission, the
`shell-keyboard-submit` plan, and the keyboard operations actually sent through
the PTY. Session action events and traces consume that same receipt.
