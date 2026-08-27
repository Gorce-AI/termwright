---
title: "Function: launchTerminal()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / launchTerminal

# Function: launchTerminal()

> **launchTerminal**(`options`): `Promise`\<[`TerminalHarness`](../../interfaces/terminalharness/)\>

Defined in: [driver/src/session.ts:256](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L256)

Launches a program in a real PTY and returns a harness over it.

The semantic endpoint is created *before* the child starts, so an
instrumented application can hand over its first tree during startup. An
uninstrumented application simply never connects: after
`semanticNegotiationMs` adapter discovery closes and the session settles as
generic (`semanticTree: false`). A peer accepted before that boundary keeps
only its own bounded hello deadline before the same fail-closed outcome.

## Parameters

### options

[`LaunchTerminalOptions`](../../interfaces/launchterminaloptions/)

## Returns

`Promise`\<[`TerminalHarness`](../../interfaces/terminalharness/)\>

## Example

```ts
const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('ready');
await terminal.press('Control+C');
await terminal.close();
```
