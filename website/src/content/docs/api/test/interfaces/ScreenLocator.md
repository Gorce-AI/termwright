---
title: "Interface: ScreenLocator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ScreenLocator

# Interface: ScreenLocator

Defined in: driver/dist/session-Bg0dDZp-.d.ts:602

## Extends

- `LocatorBase`\<`"screen"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:539

Human-readable form of the query, as it appears in error messages.

#### Inherited from

`LocatorBase.description`

***

### domain

> `readonly` **domain**: `"screen"`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:537

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<`ActionabilityExplanation`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:610

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:543

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:567

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:548

Current committed observation used to arm race-free custom waits.

#### Returns

`ObservationStamp`

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:553

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:546

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:554

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:556

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:609

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:605

#### Parameters

##### options

`ScreenLocatorFilterOptions`

#### Returns

`ScreenLocator`

***

### first()

> **first**(): `ScreenLocator`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:540

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.first`

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:559

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `ScreenLocator`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:604

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:563

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:555

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:541

#### Returns

`ScreenLocator`

#### Inherited from

`LocatorBase.last`

***

### nth()

> **nth**(`index`): `ScreenLocator`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:542

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:544

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:545

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:568

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:561

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:606

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:550

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:557

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:603

#### Parameters

##### parent

`ScreenLocator`

#### Returns

`ScreenLocator`
