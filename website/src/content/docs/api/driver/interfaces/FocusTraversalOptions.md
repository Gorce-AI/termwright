---
title: "Interface: FocusTraversalOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / FocusTraversalOptions

# Interface: FocusTraversalOptions

Defined in: [driver/src/api.ts:186](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L186)

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

## Extends

- [`WaitOptions`](../waitoptions/)

## Properties

### maxSteps?

> `readonly` `optional` **maxSteps?**: `number`

Defined in: [driver/src/api.ts:190](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L190)

Hard bound. Defaults to the number of nodes exposing semantic focus state.

***

### next?

> `readonly` `optional` **next?**: `string`

Defined in: [driver/src/api.ts:188](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L188)

Physical key that advances the application's focus ring. Defaults to Tab.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:598](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L598)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
