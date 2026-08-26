---
title: "Interface: SessionEventMap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventMap

# Interface: SessionEventMap

Defined in: [driver/src/api.ts:1096](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1096)

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

Defined in: [driver/src/api.ts:1120](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1120)

One harness or locator action, reported after it finished.

***

### action-start

> **action-start**: [`ActionStartedEvent`](../actionstartedevent/)

Defined in: [driver/src/api.ts:1122](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1122)

One harness or locator action, reported immediately before it begins.

***

### app-log

> **app-log**: [`AppLogEvent`](../applogevent/)

Defined in: [driver/src/api.ts:1118](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1118)

A line or record from the application own log.

***

### crash

> **crash**: [`CrashReport`](../crashreport/)

Defined in: [driver/src/api.ts:1127](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1127)

The child died unexpectedly. Emitted before `exit`, so a listener reacting
to the exit can already read [TerminalHarness.crashReport](../terminalharness/#crashreport).

***

### diagnostic

> **diagnostic**: [`SessionDiagnostic`](../sessiondiagnostic/)

Defined in: [driver/src/api.ts:1098](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1098)

***

### exit

> **exit**: [`ExitStatus`](../exitstatus/) & `object`

Defined in: [driver/src/api.ts:1116](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1116)

#### Type Declaration

##### timeMs

> `readonly` **timeMs**: `number`

***

### input

> **input**: `object`

Defined in: [driver/src/api.ts:1099](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1099)

#### data

> `readonly` **data**: `Uint8Array`

#### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

#### timeMs

> `readonly` **timeMs**: `number`

***

### output

> **output**: `object`

Defined in: [driver/src/api.ts:1097](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1097)

#### data

> `readonly` **data**: `Uint8Array`

#### timeMs

> `readonly` **timeMs**: `number`

***

### resize

> **resize**: `object`

Defined in: [driver/src/api.ts:1104](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1104)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### screen-revision

> **screen-revision**: `object`

Defined in: [driver/src/api.ts:1109](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1109)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### semantic-revision

> **semantic-revision**: `object`

Defined in: [driver/src/api.ts:1110](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1110)

#### revision

> `readonly` **revision**: `number`

#### snapshot

> `readonly` **snapshot**: `SemanticSnapshot`

The exact committed tree for this event; never read back from newer state.

#### timeMs

> `readonly` **timeMs**: `number`
