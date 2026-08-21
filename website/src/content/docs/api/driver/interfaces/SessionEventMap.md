---
title: "Interface: SessionEventMap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventMap

# Interface: SessionEventMap

Defined in: [driver/src/api.ts:864](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L864)

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

Defined in: [driver/src/api.ts:875](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L875)

One harness or locator action, reported after it finished.

***

### action-start

> **action-start**: [`ActionStartedEvent`](../actionstartedevent/)

Defined in: [driver/src/api.ts:877](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L877)

One harness or locator action, reported immediately before it begins.

***

### app-log

> **app-log**: [`AppLogEvent`](../applogevent/)

Defined in: [driver/src/api.ts:873](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L873)

A line or record from the application own log.

***

### crash

> **crash**: [`CrashReport`](../crashreport/)

Defined in: [driver/src/api.ts:882](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L882)

The child died unexpectedly. Emitted before `exit`, so a listener reacting
to the exit can already read [TerminalHarness.crashReport](../terminalharness/#crashreport).

***

### diagnostic

> **diagnostic**: [`SessionDiagnostic`](../sessiondiagnostic/)

Defined in: [driver/src/api.ts:866](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L866)

***

### exit

> **exit**: [`ExitStatus`](../exitstatus/) & `object`

Defined in: [driver/src/api.ts:871](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L871)

#### Type Declaration

##### timeMs

> `readonly` **timeMs**: `number`

***

### input

> **input**: `object`

Defined in: [driver/src/api.ts:867](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L867)

#### data

> `readonly` **data**: `Uint8Array`

#### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

#### timeMs

> `readonly` **timeMs**: `number`

***

### output

> **output**: `object`

Defined in: [driver/src/api.ts:865](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L865)

#### data

> `readonly` **data**: `Uint8Array`

#### timeMs

> `readonly` **timeMs**: `number`

***

### resize

> **resize**: `object`

Defined in: [driver/src/api.ts:868](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L868)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### screen-revision

> **screen-revision**: `object`

Defined in: [driver/src/api.ts:869](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L869)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`

***

### semantic-revision

> **semantic-revision**: `object`

Defined in: [driver/src/api.ts:870](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L870)

#### revision

> `readonly` **revision**: `number`

#### timeMs

> `readonly` **timeMs**: `number`
