---
title: "Interface: TerminalModes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalModes

# Interface: TerminalModes

Defined in: [api.ts:305](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L305)

`@termwright/driver` — PTY + VT sessions, locators, actions and waits.

The normative public API lives in `api.ts`; this module is the only entry
point and re-exports the types from there together with their runtime
implementations.

## Example

```ts
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('Ready');
await terminal.getByRole('button', { name: 'Approve' }).activate();
await terminal.close();
```

## Properties

### applicationCursorKeys

> `readonly` **applicationCursorKeys**: `boolean`

Defined in: [api.ts:324](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L324)

***

### applicationKeypad

> `readonly` **applicationKeypad**: `boolean`

Defined in: [api.ts:325](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L325)

***

### bracketedPaste

> `readonly` **bracketedPaste**: `boolean`

Defined in: [api.ts:323](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L323)

***

### focusReporting

> `readonly` **focusReporting**: `"unknown"` \| `"on"` \| `"off"`

Defined in: [api.ts:336](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L336)

Whether the child asked for focus in/out reports, or `'unknown'`.

`'unknown'` means the reading is the host's state and says nothing about
the child — which covers both ways the value gets falsified: a request the
terminal swallowed, and a state the terminal added on its own. ConPTY does
the second: it reports focus reporting as enabled for a child that never
asked, so a driver that believes it sends `CSI I` to a program that will
print it.

***

### mouseEncoding

> `readonly` **mouseEncoding**: `"default"` \| `"unknown"` \| `"sgr"` \| `"urxvt"` \| `"utf8"`

Defined in: [api.ts:322](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L322)

Mouse report encoding, or `'unknown'` when the platform hides it (see
[TerminalModes.mouseTracking](#mousetracking)). Input sent under `'unknown'` uses
SGR, the encoding every program that enables mouse reporting understands.

***

### mouseTracking

> `readonly` **mouseTracking**: `"unknown"` \| `"none"` \| `"x10"` \| `"vt200"` \| `"drag"` \| `"any"`

Defined in: [api.ts:316](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L316)

Mouse tracking level the child asked for, or `'unknown'`.

`'none'` means observed off — the child enabled nothing. `'unknown'` means
the platform makes the mode unobservable: ConPTY is an emulator, so it
consumes the child's `CSI ? 1000/1002/1006 h` instead of forwarding it, and
the driver never learns what was asked for. The distinction is load-bearing
for pointer actions: `'none'` is a reason to refuse, `'unknown'` is not,
because the child still has tracking on and still decodes reports.

***

### synchronizedOutput

> `readonly` **synchronizedOutput**: `boolean`

Defined in: [api.ts:337](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L337)
