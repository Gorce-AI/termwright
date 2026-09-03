---
title: "Interface: LocatorCellSnapshotOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshotOptions

# Interface: LocatorCellSnapshotOptions

Defined in: [driver/src/api.ts:720](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L720)

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

### box?

> `readonly` `optional` **box?**: `"visible"` \| `"intended"`

Defined in: [driver/src/api.ts:721](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L721)

***

### padding?

> `readonly` `optional` **padding?**: `number` \| \{ `bottom?`: `number`; `left?`: `number`; `right?`: `number`; `top?`: `number`; \}

Defined in: [driver/src/api.ts:722](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L722)
