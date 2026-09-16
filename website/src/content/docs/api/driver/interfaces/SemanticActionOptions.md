---
title: "Interface: SemanticActionOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticActionOptions

# Interface: SemanticActionOptions

Defined in: [driver/src/api.ts:607](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L607)

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

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:598](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L598)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)

***

### via?

> `readonly` `optional` **via?**: `"auto"` \| `"keyboard"` \| `"pointer"`

Defined in: [driver/src/api.ts:609](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L609)

`auto` prefers a certified keyboard recipe, then uses verified pointer input.
