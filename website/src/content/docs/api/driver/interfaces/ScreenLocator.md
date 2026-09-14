---
title: "Interface: ScreenLocator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenLocator

# Interface: ScreenLocator

Defined in: [driver/src/api.ts:728](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L728)

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

- `LocatorBase`\<`"screen"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: [driver/src/api.ts:625](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L625)

Human-readable form of the query, as it appears in error messages.

#### Inherited from

`LocatorBase.description`

***

### domain

> `readonly` **domain**: `"screen"`

Defined in: [driver/src/api.ts:623](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L623)

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

Defined in: [driver/src/api.ts:738](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L738)

#### Parameters

##### action

`"click"` \| `"double-click"` \| `"hover"`

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

***

### and()

> **and**(`other`): `ScreenLocator`

Defined in: [driver/src/api.ts:629](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L629)

#### Parameters

##### other

`ScreenLocator`

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.and`

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

Defined in: [driver/src/api.ts:656](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L656)

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

[`LocatorCellSnapshotOptions`](../locatorcellsnapshotoptions/)

#### Returns

`Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

#### Inherited from

`LocatorBase.cellSnapshot`

***

### checkpoint()

> **checkpoint**(): [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:636](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L636)

Current committed observation used to arm race-free custom waits.

#### Returns

[`ObservationStamp`](../observationstamp/)

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:643](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L643)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.click`

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: [driver/src/api.ts:634](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L634)

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:644](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L644)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.doubleClick`

***

### dragTo()

> **dragTo**(`target`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:646](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L646)

#### Parameters

##### target

`ScreenLocator`

##### opts?

[`LocatorDragOptions`](../locatordragoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.dragTo`

***

### evaluateCondition()

> **evaluateCondition**(`condition`, `opts?`): `Promise`\<[`ConditionResult`](../conditionresult/)\>

Defined in: [driver/src/api.ts:737](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L737)

#### Parameters

##### condition

[`ScreenCondition`](../../type-aliases/screencondition/)

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ConditionResult`](../conditionresult/)\>

***

### filter()

> **filter**(`options`): `ScreenLocator`

Defined in: [driver/src/api.ts:731](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L731)

#### Parameters

##### options

[`ScreenLocatorFilterOptions`](../screenlocatorfilteroptions/)

#### Returns

`ScreenLocator`

***

### first()

> **first**(): `ScreenLocator`

Defined in: [driver/src/api.ts:626](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L626)

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.first`

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [driver/src/api.ts:650](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L650)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `ScreenLocator`

Defined in: [driver/src/api.ts:730](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L730)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`ScreenTextLocatorOptions`](../screentextlocatoroptions/)

#### Returns

`ScreenLocator`

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: [driver/src/api.ts:654](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L654)

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

#### Inherited from

`LocatorBase.hitTest`

***

### hover()

> **hover**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:645](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L645)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.hover`

***

### last()

> **last**(): `ScreenLocator`

Defined in: [driver/src/api.ts:627](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L627)

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.last`

***

### nth()

> **nth**(`index`): `ScreenLocator`

Defined in: [driver/src/api.ts:628](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L628)

#### Parameters

##### index

`number`

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.nth`

***

### or()

> **or**(`other`): `ScreenLocator`

Defined in: [driver/src/api.ts:630](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L630)

#### Parameters

##### other

`ScreenLocator`

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.or`

***

### resolve()

> **resolve**(`opts?`): `Promise`\<[`ResolvedTarget`](../resolvedtarget/)\<`"screen"`\>\>

Defined in: [driver/src/api.ts:633](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L633)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ResolvedTarget`](../resolvedtarget/)\<`"screen"`\>\>

#### Inherited from

`LocatorBase.resolve`

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: [driver/src/api.ts:657](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L657)

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [driver/src/api.ts:652](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L652)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:732](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L732)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:638](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L638)

Waits for a newer committed observation without a check/subscribe gap.

#### Parameters

##### options

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ObservationStamp`](../observationstamp/)\>

#### Inherited from

`LocatorBase.waitForCheckpointChange`

***

### wheel()

> **wheel**(`opts`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:647](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L647)

#### Parameters

##### opts

[`LocatorWheelOptions`](../locatorwheeloptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.wheel`

***

### within()

> **within**(`parent`): `ScreenLocator`

Defined in: [driver/src/api.ts:729](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L729)

#### Parameters

##### parent

`ScreenLocator`

#### Returns

`ScreenLocator`
