---
title: "Interface: SessionCapabilities"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionCapabilities

# Interface: SessionCapabilities

Defined in: [driver/src/api.ts:315](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L315)

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

Defined in: [driver/src/api.ts:319](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L319)

#### name

> `readonly` **name**: `string`

#### version

> `readonly` **version**: `string`

***

### capabilities

> `readonly` **capabilities**: readonly `string`[]

Defined in: [driver/src/api.ts:322](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L322)

***

### platform

> `readonly` **platform**: `Platform`

Defined in: [driver/src/api.ts:323](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L323)

***

### probe?

> `readonly` `optional` **probe?**: `ProbeInfo`

Defined in: [driver/src/api.ts:321](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L321)

Self-description supplied by an instrumented framework probe.

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [driver/src/api.ts:316](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L316)

***

### terminalProfile

> `readonly` **terminalProfile**: `string`

Defined in: [driver/src/api.ts:318](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L318)

Id of the terminal profile this session counts characters with.
