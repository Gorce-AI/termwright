---
title: "Interface: SemanticLocator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SemanticLocator

# Interface: SemanticLocator

Defined in: driver/dist/session-CrSmiIK6.d.ts:504

## Extends

- `LocatorBase`\<`"semantic"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/session-CrSmiIK6.d.ts:473

Human-readable form of the query, as it appears in error messages.

#### Inherited from

[`ScreenLocator`](../screenlocator/).[`description`](../screenlocator/#description)

***

### domain

> `readonly` **domain**: `"semantic"`

Defined in: driver/dist/session-CrSmiIK6.d.ts:471

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<`ActionabilityExplanation`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:518

#### Parameters

##### action

`"click"` \| `"double-click"` \| `"hover"` \| `"focus"` \| `"activate"` \| `"press"` \| `"type"` \| `"fill"` \| `"check"` \| `"uncheck"`

##### opts?

`PointerOptions` & `object`

#### Returns

`Promise`\<`ActionabilityExplanation`\>

***

### activate()

> **activate**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:525

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### and()

> **and**(`other`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:477

#### Parameters

##### other

`SemanticLocator`

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.and`

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<`LocatorCellSnapshot`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:501

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

`LocatorCellSnapshotOptions`

#### Returns

`Promise`\<`LocatorCellSnapshot`\>

#### Inherited from

`LocatorBase.cellSnapshot`

***

### check()

> **check**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:526

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### checkpoint()

> **checkpoint**(): `ObservationStamp`

Defined in: driver/dist/session-CrSmiIK6.d.ts:482

Current committed observation used to arm race-free custom waits.

#### Returns

`ObservationStamp`

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:487

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

Defined in: driver/dist/session-CrSmiIK6.d.ts:480

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:488

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

Defined in: driver/dist/session-CrSmiIK6.d.ts:490

#### Parameters

##### target

`SemanticLocator`

##### opts?

`LocatorDragOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.dragTo`

***

### evaluateCondition()

> **evaluateCondition**(`condition`, `opts?`): `Promise`\<`ConditionResult`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:517

#### Parameters

##### condition

`Condition`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ConditionResult`\>

***

### extendedState()

> **extendedState**(): `Promise`\<`SemanticExtendedObject` \| `null`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:534

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:523

#### Parameters

##### text

`ExecutableValue`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### filter()

> **filter**(`options`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:513

#### Parameters

##### options

`SemanticLocatorFilterOptions`

#### Returns

`SemanticLocator`

***

### first()

> **first**(): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:474

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.first`

***

### focus()

> **focus**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:524

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:493

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:507

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

###### exact?

`boolean`

#### Returns

`SemanticLocator`

***

### getByRole()

> **getByRole**(`role`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:506

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

`RoleLocatorOptions`

#### Returns

`SemanticLocator`

***

### getByTestId()

> **getByTestId**(`testId`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:511

#### Parameters

##### testId

`string`

#### Returns

`SemanticLocator`

***

### getByText()

> **getByText**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:510

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`TextLocatorOptions`

#### Returns

`SemanticLocator`

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:497

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

Defined in: driver/dist/session-CrSmiIK6.d.ts:489

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.hover`

***

### last()

> **last**(): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:475

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.last`

***

### locator()

> **locator**(`selector`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:512

#### Parameters

##### selector

`string`

#### Returns

`SemanticLocator`

***

### nth()

> **nth**(`index`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:476

#### Parameters

##### index

`number`

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.nth`

***

### or()

> **or**(`other`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:478

#### Parameters

##### other

`SemanticLocator`

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.or`

***

### paintedRegion()

> **paintedRegion**(): `Promise`\<`Observation`\<`SemanticPaintedRegion`\>\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:532

Exact cells painted by this semantic recipient, never inferred from layout.

#### Returns

`Promise`\<`Observation`\<`SemanticPaintedRegion`\>\>

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:521

#### Parameters

##### keys

`string`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### resolve()

> **resolve**(`opts?`): `Promise`\<`ResolvedTarget`\<`"semantic"`\>\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:479

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ResolvedTarget`\<`"semantic"`\>\>

#### Inherited from

`LocatorBase.resolve`

***

### semanticScroll()

> **semanticScroll**(): `Promise`\<`Observation`\<`SemanticScrollState`\>\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:530

Production application viewport state, never emulator scrollback position.

#### Returns

`Promise`\<`Observation`\<`SemanticScrollState`\>\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:533

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<`SemanticValueObservation`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:528

#### Returns

`Promise`\<`SemanticValueObservation`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:502

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### type()

> **type**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:522

#### Parameters

##### text

`ExecutableValue`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### uncheck()

> **uncheck**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:527

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:495

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:514

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-CrSmiIK6.d.ts:484

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

Defined in: driver/dist/session-CrSmiIK6.d.ts:491

#### Parameters

##### opts

`LocatorWheelOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

#### Inherited from

`LocatorBase.wheel`

***

### within()

> **within**(`parent`): `SemanticLocator`

Defined in: driver/dist/session-CrSmiIK6.d.ts:505

#### Parameters

##### parent

`SemanticLocator`

#### Returns

`SemanticLocator`
