---
title: "Function: launchTerminal()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / launchTerminal

# Function: launchTerminal()

> **launchTerminal**(`options`): `Promise`\<[`TerminalHarness`](../../interfaces/terminalharness/)\>

Defined in: [driver/src/session.ts:282](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L282)

Launches a program in a real PTY and returns a harness over it.

The semantic endpoint is created *before* the child starts, so an
instrumented application can hand over its first tree during startup. An
uninstrumented application simply never connects: after
`semanticNegotiationMs` the session settles as generic (`semanticTree:
false`) and keeps working with grid locators.

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
