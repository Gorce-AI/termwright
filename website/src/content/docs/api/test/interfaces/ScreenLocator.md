---
title: "Interface: ScreenLocator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ScreenLocator

# Interface: ScreenLocator

Defined in: driver/dist/session-BXtgF5fU.d.ts:542

## Extends

- `LocatorBase`\<`"screen"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/session-BXtgF5fU.d.ts:479

Human-readable form of the query, as it appears in error messages.

#### Inherited from

`LocatorBase.description`

***

### domain

> `readonly` **domain**: `"screen"`

Defined in: driver/dist/session-BXtgF5fU.d.ts:477

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<`ActionabilityExplanation`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:550

#### Parameters

##### action

`"click"` \| `"double-click"` \| `"hover"`

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionabilityExplanation`\>

***

### and()

> **and**(`other`): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:483

#### Parameters

##### other

`ScreenLocator`

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.and`

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<`LocatorCellSnapshot`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:507

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

`LocatorCellSnapshotOptions`

#### Returns

`Promise`\<`LocatorCellSnapshot`\>

#### Inherited from

`LocatorBase.cellSnapshot`

***

### checkpoint()

> **checkpoint**(): `ObservationStamp`

Defined in: driver/dist/session-BXtgF5fU.d.ts:488

Current committed observation used to arm race-free custom waits.

#### Returns

`ObservationStamp`

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:493

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.click`

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:486

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:494

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.doubleClick`

***

### dragTo()

> **dragTo**(`target`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:496

#### Parameters

##### target

`ScreenLocator`

##### opts?

`LocatorDragOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.dragTo`

***

### evaluateCondition()

> **evaluateCondition**(`condition`, `opts?`): `Promise`\<`ConditionResult`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:549

#### Parameters

##### condition

`ScreenCondition`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ConditionResult`\>

***

### filter()

> **filter**(`options`): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:545

#### Parameters

##### options

`ScreenLocatorFilterOptions`

#### Returns

`ScreenLocator`

***

### first()

> **first**(): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:480

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.first`

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:499

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:544

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`ScreenTextLocatorOptions`

#### Returns

`ScreenLocator`

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:503

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

> **hover**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:495

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.hover`

***

### last()

> **last**(): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:481

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.last`

***

### nth()

> **nth**(`index`): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:482

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

Defined in: driver/dist/session-BXtgF5fU.d.ts:484

#### Parameters

##### other

`ScreenLocator`

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.or`

***

### resolve()

> **resolve**(`opts?`): `Promise`\<`ResolvedTarget`\<`"screen"`\>\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:485

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ResolvedTarget`\<`"screen"`\>\>

#### Inherited from

`LocatorBase.resolve`

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:508

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:501

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:546

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:490

Waits for a newer committed observation without a check/subscribe gap.

#### Parameters

##### options

`object` & `WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

#### Inherited from

`LocatorBase.waitForCheckpointChange`

***

### wheel()

> **wheel**(`opts`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BXtgF5fU.d.ts:497

#### Parameters

##### opts

`LocatorWheelOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.wheel`

***

### within()

> **within**(`parent`): `ScreenLocator`

Defined in: driver/dist/session-BXtgF5fU.d.ts:543

#### Parameters

##### parent

`ScreenLocator`

#### Returns

`ScreenLocator`
