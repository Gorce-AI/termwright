---
title: "Interface: SessionCapabilities"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionCapabilities

# Interface: SessionCapabilities

Defined in: [api.ts:243](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L243)

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

### adapter?

> `readonly` `optional` **adapter?**: `object`

Defined in: [api.ts:247](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L247)

#### name

> `readonly` **name**: `string`

#### version

> `readonly` **version**: `string`

***

### capabilities

> `readonly` **capabilities**: readonly `string`[]

Defined in: [api.ts:250](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L250)

***

### platform

> `readonly` **platform**: `Platform`

Defined in: [api.ts:251](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L251)

***

### probe?

> `readonly` `optional` **probe?**: `ProbeInfo`

Defined in: [api.ts:249](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L249)

Self-description supplied by an instrumented framework probe.

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [api.ts:244](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L244)

***

### terminalProfile

> `readonly` **terminalProfile**: `string`

Defined in: [api.ts:246](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L246)

Id of the terminal profile this session counts characters with.
