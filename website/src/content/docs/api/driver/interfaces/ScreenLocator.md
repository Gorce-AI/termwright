---
title: "Interface: ScreenLocator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenLocator

# Interface: ScreenLocator

Defined in: [driver/src/api.ts:685](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L685)

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

Defined in: [driver/src/api.ts:565](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L565)

Human-readable form of the query, as it appears in error messages.

#### Inherited from

`LocatorBase.description`

***

### domain

> `readonly` **domain**: `"screen"`

Defined in: [driver/src/api.ts:563](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L563)

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

Defined in: [driver/src/api.ts:707](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L707)

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

Defined in: [driver/src/api.ts:569](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L569)

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

Defined in: [driver/src/api.ts:601](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L601)

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

Defined in: [driver/src/api.ts:576](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L576)

Current committed observation used to arm race-free custom waits.

#### Returns

[`ObservationStamp`](../observationstamp/)

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:583](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L583)

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

Defined in: [driver/src/api.ts:574](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L574)

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:584](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L584)

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

Defined in: [driver/src/api.ts:586](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L586)

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

Defined in: [driver/src/api.ts:703](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L703)

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

Defined in: [driver/src/api.ts:691](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L691)

#### Parameters

##### options

[`ScreenLocatorFilterOptions`](../screenlocatorfilteroptions/)

#### Returns

`ScreenLocator`

***

### first()

> **first**(): `ScreenLocator`

Defined in: [driver/src/api.ts:566](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L566)

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.first`

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [driver/src/api.ts:593](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L593)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `ScreenLocator`

Defined in: [driver/src/api.ts:687](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L687)

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

Defined in: [driver/src/api.ts:597](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L597)

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

Defined in: [driver/src/api.ts:585](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L585)

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

Defined in: [driver/src/api.ts:567](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L567)

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.last`

***

### nth()

> **nth**(`index`): `ScreenLocator`

Defined in: [driver/src/api.ts:568](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L568)

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

Defined in: [driver/src/api.ts:570](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L570)

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

Defined in: [driver/src/api.ts:573](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L573)

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

Defined in: [driver/src/api.ts:602](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L602)

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [driver/src/api.ts:595](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L595)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:692](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L692)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:578](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L578)

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

Defined in: [driver/src/api.ts:590](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L590)

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

Defined in: [driver/src/api.ts:686](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L686)

#### Parameters

##### parent

`ScreenLocator`

#### Returns

`ScreenLocator`
