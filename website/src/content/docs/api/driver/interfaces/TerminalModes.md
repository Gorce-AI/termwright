---
title: "Interface: TerminalModes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalModes

# Interface: TerminalModes

Defined in: [driver/src/api.ts:377](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L377)

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

Defined in: [driver/src/api.ts:397](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L397)

***

### applicationKeypad

> `readonly` **applicationKeypad**: `boolean`

Defined in: [driver/src/api.ts:398](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L398)

***

### bracketedPaste

> `readonly` **bracketedPaste**: `boolean`

Defined in: [driver/src/api.ts:396](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L396)

***

### focusReporting

> `readonly` **focusReporting**: `"unknown"` \| `"on"` \| `"off"`

Defined in: [driver/src/api.ts:409](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L409)

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

Defined in: [driver/src/api.ts:395](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L395)

Mouse report encoding, or `'unknown'` when the platform hides it (see
[TerminalModes.mouseTracking](#mousetracking)). Pointer actions fail closed under
`'unknown'`; Termwright never guesses SGR.

***

### mouseTracking

> `readonly` **mouseTracking**: `"unknown"` \| `"none"` \| `"x10"` \| `"vt200"` \| `"drag"` \| `"any"`

Defined in: [driver/src/api.ts:389](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L389)

Mouse tracking level the child asked for, or `'unknown'`.

`'none'` means observed off — the child enabled nothing. `'unknown'` means
the platform makes the mode unobservable: ConPTY is an emulator, so it
consumes the child's `CSI ? 1000/1002/1006 h` instead of forwarding it, and
the driver never learns what was asked for. The distinction is load-bearing
for pointer actions: `'none'` is authoritatively off, while `'unknown'`
means Termwright cannot select a protocol without guessing. Both fail
before input is written, with distinct diagnostics.

***

### synchronizedOutput

> `readonly` **synchronizedOutput**: `boolean`

Defined in: [driver/src/api.ts:410](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L410)
