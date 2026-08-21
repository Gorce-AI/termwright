---
title: "Interface: ActivateReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActivateReceipt

# Interface: ActivateReceipt

Defined in: [api.ts:530](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L530)

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

### ref

> `readonly` **ref**: `string`

Defined in: [api.ts:532](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L532)

***

### strategy

> `readonly` **strategy**: `"click"` \| `"focus-enter"` \| `"focus-space"`

Defined in: [api.ts:531](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L531)
