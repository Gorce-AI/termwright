---
title: Migrate to Termwright
description: Replace an existing terminal-test harness with Termwright.
---

Use this guide when you already test a CLI or TUI with another harness. If you
know Playwright or Cypress but are starting a terminal test suite, see
[Coming from Playwright or Cypress](../../concepts/web-testing/) instead.

## From `ink-testing-library`

Use `mountInk()` as the in-process replacement for `render()`. It supports
current Ink releases and adds terminal input, focus, resize, semantic locators,
and retained traces beyond `lastFrame()` string assertions.

```tsx
// before
import {render} from 'ink-testing-library';

const {lastFrame, stdin, rerender} = render(<Approve />);
stdin.write('\r');
expect(lastFrame()).toContain('approved');
```

```tsx
// after
import {mountInk} from 'termwright/ink';

const harness = await mountInk(<Approve />);
await harness.press('Enter');
await harness.waitForText('approved');
await harness.close();
```

| `ink-testing-library` | Termwright |
|---|---|
| `render(<App />)` | `await mountInk(<App />)` |
| `lastFrame()` | `harness.screen().text()`, `waitForText()`, or `toHaveText()` |
| `frames` | retained [trace recording](../../tools/traces-reports/) |
| `stdin.write('\r')` | `harness.press('Enter')` |
| `rerender(<App />)` | `await harness.rerender(<App />)` |
| `unmount()` | `await harness.close()` |

Calls are asynchronous because they wait for rendered terminal state. Add the
[Ink integration](../../adapters/ink/) when the test needs semantic roles,
names, focus, or state.

## From `expect` or `pexpect`

Translate stream expectations to terminal state and input operations:

```python
# before
child.expect('Permission required')
child.sendline('y')
child.expect('running:')
```

```ts
// after
await app.waitForText('Permission required');
await app.press('y');
await app.waitForText('running:');
```

Use `waitForText()` for rendered output and `press()`, `type()`, or `paste()`
for input. Termwright models the current terminal grid rather than matching
only an output stream, and a failed test can retain a replayable trace.

There is no `send` / `expect(pattern)` compatibility API.

## From a custom PTY, `spawn()`, or tmux harness

Keep the executable and user-visible scenarios. Replace process lifecycle,
terminal parsing, polling, and artifact collection with the corresponding
Termwright surfaces:

| Existing harness | Termwright |
|---|---|
| `spawn()` or PTY setup | `terminal.launch()` |
| raw stdout buffer | `app.screen()` |
| polling loop | `waitForText()` or a retrying assertion |
| stdin writes | `press()`, `type()`, or `paste()` |
| shared fixture directory | `launch({files})` or `launch({template})` |
| transcript on failure | retained trace and HTML report |

Start by preserving the existing keyboard-driven workflow. Add semantic
locators only after the relevant [framework integration](../../adapters/) is
running and verified.
