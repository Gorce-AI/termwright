---
title: "Interface: Locator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Locator

# Interface: Locator

Defined in: [api.ts:402](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L402)

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

### description

> `readonly` **description**: `string`

Defined in: [api.ts:404](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L404)

Human-readable form of the query, as it appears in error messages.

## Methods

### activate()

> **activate**(`opts?`): `Promise`\<[`ActivateReceipt`](../activatereceipt/)\>

Defined in: [api.ts:424](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L424)

Documented physical strategy (click, or focus+Enter); receipt says which.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActivateReceipt`](../activatereceipt/)\>

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

Defined in: [api.ts:435](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L435)

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

[`LocatorCellSnapshotOptions`](../locatorcellsnapshotoptions/)

#### Returns

`Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

***

### click()

> **click**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:415](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L415)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<`void`\>

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: [api.ts:412](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L412)

#### Returns

`Promise`\<`number`\>

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:416](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L416)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<`void`\>

***

### drag()

> **drag**(`opts`): `Promise`\<`void`\>

Defined in: [api.ts:418](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L418)

#### Parameters

##### opts

###### from

\{ `column`: `number`; `row`: `number`; \}

###### from.column

`number`

###### from.row

`number`

###### to

\{ `column`: `number`; `row`: `number`; \}

###### to.column

`number`

###### to.row

`number`

#### Returns

`Promise`\<`void`\>

***

### dragTo()

> **dragTo**(`target`, `opts?`): `Promise`\<`void`\>

Defined in: [api.ts:417](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L417)

#### Parameters

##### target

`Locator`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### extendedState()

> **extendedState**(): `Promise`\<`SemanticExtendedObject` \| `null`\>

Defined in: [api.ts:439](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L439)

Application-defined state, separate from portable semantic flags.

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### first()

> **first**(): `Locator`

Defined in: [api.ts:407](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L407)

#### Returns

`Locator`

***

### focusNode()

> **focusNode**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:422](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L422)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [api.ts:429](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L429)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: [api.ts:433](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L433)

Whether pointer input at the chosen cell reaches this exact target.

#### Parameters

##### opts?

###### position?

\{ `columnOffset`: `number`; `rowOffset`: `number`; \}

###### position.columnOffset

`number`

###### position.rowOffset

`number`

#### Returns

`Promise`\<`PointerHitTest`\>

***

### nth()

> **nth**(`index`): `Locator`

Defined in: [api.ts:408](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L408)

#### Parameters

##### index

`number`

#### Returns

`Locator`

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<`void`\>

Defined in: [api.ts:420](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L420)

#### Parameters

##### keys

`string`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### resolve()

> **resolve**(`opts?`): `Promise`\<[`ResolvedTarget`](../resolvedtarget/)\>

Defined in: [api.ts:411](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L411)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ResolvedTarget`](../resolvedtarget/)\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: [api.ts:437](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L437)

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: [api.ts:436](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L436)

#### Returns

`Promise`\<`string`\>

***

### type()

> **type**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [api.ts:421](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L421)

#### Parameters

##### text

`string`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [api.ts:431](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L431)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:427](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L427)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### wheel()

> **wheel**(`opts`): `Promise`\<`void`\>

Defined in: [api.ts:419](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L419)

#### Parameters

##### opts

###### deltaX?

`number`

###### deltaY

`number`

#### Returns

`Promise`\<`void`\>

***

### within()

> **within**(`parent`): `Locator`

Defined in: [api.ts:406](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L406)

#### Parameters

##### parent

`Locator`

#### Returns

`Locator`
