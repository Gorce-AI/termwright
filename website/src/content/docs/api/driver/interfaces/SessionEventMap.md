---
title: "Interface: SessionEventMap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventMap

# Interface: SessionEventMap

Defined in: [api.ts:748](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L748)

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

### action

> **action**: [`ActionEvent`](../actionevent/)

Defined in: [api.ts:759](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L759)

One harness or locator action, reported after it finished.

***

### action-start

> **action-start**: [`ActionStartedEvent`](../actionstartedevent/)

Defined in: [api.ts:761](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L761)

One harness or locator action, reported immediately before it begins.

***

### app-log

> **app-log**: [`AppLogEvent`](../applogevent/)

Defined in: [api.ts:757](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L757)

A line or record from the application own log.

***

### crash

> **crash**: [`CrashReport`](../crashreport/)

Defined in: [api.ts:766](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L766)

The child died unexpectedly. Emitted before `exit`, so a listener reacting
to the exit can already read [TerminalHarness.crashReport](../terminalharness/#crashreport).

***

### diagnostic

> **diagnostic**: [`SessionDiagnostic`](../sessiondiagnostic/)

Defined in: [api.ts:750](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L750)

***

### exit

> **exit**: [`ExitStatus`](../exitstatus/) & `object`

Defined in: [api.ts:755](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L755)

#### Type Declaration

##### timeMs

> `readonly` **timeMs**: `number`

***

### input

> **input**: `object`

Defined in: [api.ts:751](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L751)

#### data

> `readonly` **data**: `Uint8Array`

#### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

#### timeMs

> `readonly` **timeMs**: `number`

***

### output

> **output**: `object`

Defined in: [api.ts:749](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L749)

#### data

> `readonly` **data**: `Uint8Array`

#### timeMs

> `readonly` **timeMs**: `number`

***

### resize

> **resize**: `object`

Defined in: [api.ts:752](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L752)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### screen-revision

> **screen-revision**: `object`

Defined in: [api.ts:753](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L753)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### semantic-revision

> **semantic-revision**: `object`

Defined in: [api.ts:754](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L754)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`
