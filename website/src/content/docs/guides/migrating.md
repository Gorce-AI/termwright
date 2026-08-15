---
title: Migrating
description: Coming from ink-testing-library, teatest, Textual's Pilot, or an expect script.
---

## From `ink-testing-library`

This is the migration termwright was built for. `ink-testing-library` is the
only test harness Ink ever had; it is unmaintained and broken on current Ink,
and its model — render to a string, assert on `lastFrame()` — cannot express
focus, mouse, raw mode or a resize.

```tsx
// before
import {render} from 'ink-testing-library';

const {lastFrame, stdin, rerender} = render(<Approve />);
stdin.write('\r');
expect(lastFrame()).toContain('approved');
```

```tsx
// after
import {mountInk} from '@termwright/ink-testing';

const harness = await mountInk(<Approve />);
await harness.press('Enter');
await harness.waitForText('approved');
await harness.close();
```

The mapping is mostly mechanical:

| `ink-testing-library` | termwright |
|---|---|
| `render(<App/>)` | `await mountInk(<App/>)` |
| `lastFrame()` | `harness.screen().text()`, or `waitForText` / `toHaveText` |
| `frames` | the [trace recording](../traces/) — every frame, with timing |
| `stdin.write('\r')` | `harness.press('Enter')` |
| `rerender(<App/>)` | `await harness.rerender(<App/>)` |
| `unmount()` | `await harness.close()` |
| — | `getByRole`, `click`, `activate`, resize, raw mode, semantic snapshots |

Two differences to plan for. Everything is asynchronous, because everything
waits on a real render rather than on a string that was already built. And once
you annotate the components with [`useSemantic`](../../adapters/ink/), the
assertions stop being about frames at all:

```tsx
await expect(harness.getByRole('button', {name: 'Approve'})).toBeFocused();
```

## From Textual's Pilot

Pilot is good, and termwright is **not** a replacement for it. Pilot runs
in-process, which makes it fast and gives it access to the app object; that is
the right tool for unit-testing a widget.

Reach for termwright when you need what an in-process harness structurally
cannot give you:

- a **real pseudo-terminal** — raw mode, `SIGWINCH`, signals, exit codes, the
  program as its users run it;
- **cross-framework** tests: one suite driving your Python TUI and the Node CLI
  it shells out to;
- revision-based waiting, recordings and the failure report;
- the same session driven by an [AI agent over MCP](../mcp/).

```python
# Textual, instrumented once — dormant unless a driver is attached
from termwright import enable_semantics

class PermissionApp(App):
    def on_mount(self) -> None:
        enable_semantics(self)   # returns None when no driver is attached
```

```ts
// the test, in TypeScript, driving the real program
const app = await terminal.launch({command: ['python', 'app.py']});
await app.getByRole('button', {name: 'Approve'}).activate();
```

The two coexist: Pilot for widget-level tests, termwright for the end-to-end
lane. See [Textual](../../adapters/textual/) for what the adapter publishes.

## From teatest (Bubble Tea)

`teatest` drives a Bubble Tea `Model` in process and asserts on its output. It
stays useful, and you should be honest with yourself about what termwright adds
for Bubble Tea specifically: **a real terminal, not a semantic tree.**

Bubble Tea composes strings — Lip Gloss joins have no per-widget positions to
publish — so a Bubble Tea program is a [generic-mode](../locators/) target
unless it is built on Lip Gloss v2's Canvas/Layer. Read
[Bubble Tea](../../adapters/bubbletea/) before you plan the migration; the short
version is that you get real pty fidelity, waits, recordings and the report, but
`getByRole` is not on the table for a string-composed UI.

## From an expect script

`expect` and `pexpect` are line-oriented: they match patterns on a stream. That
works until the program starts repainting the same rows, which is precisely when
a TUI test gets hard.

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

The shapes match one-to-one, and what you gain is a *screen*: `screen().line(12)`
is answerable, colours and modes are modelled, and a failure leaves a recording
instead of a stream transcript.

A thin `send` / `expect(pattern)` compatibility shim over the driver is planned
for 1.x as a mechanical migration path. It does not exist yet — today the
translation above is the migration.
