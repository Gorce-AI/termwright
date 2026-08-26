---
title: "Interface: SessionEventMap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventMap

# Interface: SessionEventMap

Defined in: [driver/src/api.ts:1099](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1099)

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

Defined in: [driver/src/api.ts:1123](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1123)

One harness or locator action, reported after it finished.

***

### action-start

> **action-start**: [`ActionStartedEvent`](../actionstartedevent/)

Defined in: [driver/src/api.ts:1125](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1125)

One harness or locator action, reported immediately before it begins.

***

### app-log

> **app-log**: [`AppLogEvent`](../applogevent/)

Defined in: [driver/src/api.ts:1121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1121)

A line or record from the application own log.

***

### crash

> **crash**: [`CrashReport`](../crashreport/)

Defined in: [driver/src/api.ts:1130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1130)

The child died unexpectedly. Emitted before `exit`, so a listener reacting
to the exit can already read [TerminalHarness.crashReport](../terminalharness/#crashreport).

***

### diagnostic

> **diagnostic**: [`SessionDiagnostic`](../sessiondiagnostic/)

Defined in: [driver/src/api.ts:1101](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1101)

***

### exit

> **exit**: [`ExitStatus`](../exitstatus/) & `object`

Defined in: [driver/src/api.ts:1119](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1119)

#### Type Declaration

##### timeMs

> `readonly` **timeMs**: `number`

***

### input

> **input**: `object`

Defined in: [driver/src/api.ts:1102](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1102)

#### data

> `readonly` **data**: `Uint8Array`

#### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

#### timeMs

> `readonly` **timeMs**: `number`

***

### output

> **output**: `object`

Defined in: [driver/src/api.ts:1100](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1100)

#### data

> `readonly` **data**: `Uint8Array`

#### timeMs

> `readonly` **timeMs**: `number`

***

### resize

> **resize**: `object`

Defined in: [driver/src/api.ts:1107](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1107)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### screen-revision

> **screen-revision**: `object`

Defined in: [driver/src/api.ts:1112](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1112)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### semantic-revision

> **semantic-revision**: `object`

Defined in: [driver/src/api.ts:1113](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1113)

#### revision

> `readonly` **revision**: `number`

#### snapshot

> `readonly` **snapshot**: `SemanticSnapshot`

The exact committed tree for this event; never read back from newer state.

#### timeMs

> `readonly` **timeMs**: `number`
