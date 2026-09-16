---
title: "Interface: ScreenLocator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenLocator

# Interface: ScreenLocator

Defined in: [driver/src/api.ts:734](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L734)

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

Defined in: [driver/src/api.ts:631](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L631)

Human-readable form of the query, as it appears in error messages.

#### Inherited from

`LocatorBase.description`

***

### domain

> `readonly` **domain**: `"screen"`

Defined in: [driver/src/api.ts:629](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L629)

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

Defined in: [driver/src/api.ts:744](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L744)

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

Defined in: [driver/src/api.ts:635](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L635)

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

Defined in: [driver/src/api.ts:662](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L662)

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

Defined in: [driver/src/api.ts:642](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L642)

Current committed observation used to arm race-free custom waits.

#### Returns

[`ObservationStamp`](../observationstamp/)

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:649](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L649)

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

Defined in: [driver/src/api.ts:640](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L640)

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:650](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L650)

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

Defined in: [driver/src/api.ts:652](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L652)

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

Defined in: [driver/src/api.ts:743](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L743)

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

Defined in: [driver/src/api.ts:737](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L737)

#### Parameters

##### options

[`ScreenLocatorFilterOptions`](../screenlocatorfilteroptions/)

#### Returns

`ScreenLocator`

***

### first()

> **first**(): `ScreenLocator`

Defined in: [driver/src/api.ts:632](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L632)

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.first`

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [driver/src/api.ts:656](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L656)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `ScreenLocator`

Defined in: [driver/src/api.ts:736](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L736)

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

Defined in: [driver/src/api.ts:660](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L660)

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

Defined in: [driver/src/api.ts:651](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L651)

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

Defined in: [driver/src/api.ts:633](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L633)

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.last`

***

### nth()

> **nth**(`index`): `ScreenLocator`

Defined in: [driver/src/api.ts:634](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L634)

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

Defined in: [driver/src/api.ts:636](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L636)

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

Defined in: [driver/src/api.ts:639](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L639)

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

Defined in: [driver/src/api.ts:663](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L663)

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [driver/src/api.ts:658](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L658)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:738](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L738)

#### Parameters

##### opts?

`object` & [`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:644](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L644)

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

Defined in: [driver/src/api.ts:653](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L653)

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

Defined in: [driver/src/api.ts:735](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L735)

#### Parameters

##### parent

`ScreenLocator`

#### Returns

`ScreenLocator`
