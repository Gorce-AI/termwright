---
title: "Interface: TerminalModes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalModes

# Interface: TerminalModes

Defined in: [driver/src/api.ts:430](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L430)

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

Defined in: [driver/src/api.ts:455](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L455)

***

### applicationKeypad

> `readonly` **applicationKeypad**: `boolean`

Defined in: [driver/src/api.ts:456](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L456)

***

### bracketedPaste

> `readonly` **bracketedPaste**: `boolean`

Defined in: [driver/src/api.ts:454](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L454)

***

### focusReporting

> `readonly` **focusReporting**: `"unknown"` \| `"on"` \| `"off"`

Defined in: [driver/src/api.ts:465](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L465)

Whether the child asked for focus in/out reports, or `'unknown'`.

`'unknown'` means the transport's reading says nothing about the child.
Certified PTY backends preserve focus DECSET; embeddings that cannot do so
must declare the mode unobservable. Only an explicit production-state provider may supply the
revision-bound fact; generic children/shadows may not. Observable VT must agree.

***

### mouseEncoding

> `readonly` **mouseEncoding**: `"default"` \| `"unknown"` \| `"sgr"` \| `"urxvt"` \| `"utf8"`

Defined in: [driver/src/api.ts:453](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L453)

Mouse report encoding, or `'unknown'` when no authoritative source can
prove it (see
[TerminalModes.mouseTracking](#mousetracking)). Pointer actions fail closed under
`'unknown'`; Termwright never guesses SGR.

***

### mouseTracking

> `readonly` **mouseTracking**: `"none"` \| `"any"` \| `"unknown"` \| `"x10"` \| `"vt200"` \| `"drag"`

Defined in: [driver/src/api.ts:446](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L446)

Mouse tracking level the child asked for, or `'unknown'`.

`'none'` means observed off — the child enabled nothing. `'unknown'` means
neither the transport nor an explicit production-state provider can prove
it. Certified PTY backends, including pinned passthrough ConPTY, preserve
these mode requests; `'unknown'` remains available for embeddings that do
not. The distinction is load-bearing
for pointer actions: `'none'` is authoritatively off, while `'unknown'`
means Termwright cannot select a protocol without guessing. An explicitly
registered production-state provider may supply same-revision evidence;
a stdout shadow cannot, because descriptor/native/descendant writes bypass it.
Both definite `none` and unresolved `unknown` fail before input is written,
with distinct diagnostics.

***

### synchronizedOutput

> `readonly` **synchronizedOutput**: `boolean`

Defined in: [driver/src/api.ts:466](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L466)
