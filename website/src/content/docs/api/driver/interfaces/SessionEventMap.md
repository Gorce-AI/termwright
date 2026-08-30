---
title: "Interface: SessionEventMap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventMap

# Interface: SessionEventMap

Defined in: [driver/src/api.ts:1064](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1064)

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

Defined in: [driver/src/api.ts:1088](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1088)

One harness or locator action, reported after it finished.

***

### action-start

> **action-start**: [`ActionStartedEvent`](../actionstartedevent/)

Defined in: [driver/src/api.ts:1090](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1090)

One harness or locator action, reported immediately before it begins.

***

### app-log

> **app-log**: [`AppLogEvent`](../applogevent/)

Defined in: [driver/src/api.ts:1086](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1086)

A line or record from the application own log.

***

### crash

> **crash**: [`CrashReport`](../crashreport/)

Defined in: [driver/src/api.ts:1095](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1095)

The child died unexpectedly. Emitted before `exit`, so a listener reacting
to the exit can already read [TerminalHarness.crashReport](../terminalharness/#crashreport).

***

### diagnostic

> **diagnostic**: [`SessionDiagnostic`](../sessiondiagnostic/)

Defined in: [driver/src/api.ts:1066](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1066)

***

### exit

> **exit**: [`ExitStatus`](../exitstatus/) & `object`

Defined in: [driver/src/api.ts:1084](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1084)

#### Type Declaration

##### timeMs

> `readonly` **timeMs**: `number`

***

### input

> **input**: `object`

Defined in: [driver/src/api.ts:1067](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1067)

#### data

> `readonly` **data**: `Uint8Array`

#### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

#### timeMs

> `readonly` **timeMs**: `number`

***

### output

> **output**: `object`

Defined in: [driver/src/api.ts:1065](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1065)

#### data

> `readonly` **data**: `Uint8Array`

#### timeMs

> `readonly` **timeMs**: `number`

***

### resize

> **resize**: `object`

Defined in: [driver/src/api.ts:1072](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1072)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### screen-revision

> **screen-revision**: `object`

Defined in: [driver/src/api.ts:1077](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1077)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### semantic-revision

> **semantic-revision**: `object`

Defined in: [driver/src/api.ts:1078](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1078)

#### revision

> `readonly` **revision**: `number`

#### snapshot

> `readonly` **snapshot**: `SemanticSnapshot`

The exact committed tree for this event; never read back from newer state.

#### timeMs

> `readonly` **timeMs**: `number`
