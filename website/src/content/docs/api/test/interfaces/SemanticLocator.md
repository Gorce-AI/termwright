---
title: "Interface: SemanticLocator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SemanticLocator

# Interface: SemanticLocator

Defined in: driver/dist/session-BmR0tpda.d.ts:502

## Extends

- `LocatorBase`\<`"semantic"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/session-BmR0tpda.d.ts:471

Human-readable form of the query, as it appears in error messages.

#### Inherited from

[`ScreenLocator`](../screenlocator/).[`description`](../screenlocator/#description)

***

### domain

> `readonly` **domain**: `"semantic"`

Defined in: driver/dist/session-BmR0tpda.d.ts:469

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<`ActionabilityExplanation`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:516

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

Defined in: driver/dist/session-BmR0tpda.d.ts:523

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### and()

> **and**(`other`): `SemanticLocator`

Defined in: driver/dist/session-BmR0tpda.d.ts:475

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

Defined in: driver/dist/session-BmR0tpda.d.ts:499

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

Defined in: driver/dist/session-BmR0tpda.d.ts:524

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### checkpoint()

> **checkpoint**(): `ObservationStamp`

Defined in: driver/dist/session-BmR0tpda.d.ts:480

Current committed observation used to arm race-free custom waits.

#### Returns

`ObservationStamp`

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:485

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

Defined in: driver/dist/session-BmR0tpda.d.ts:478

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:486

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

Defined in: driver/dist/session-BmR0tpda.d.ts:488

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

Defined in: driver/dist/session-BmR0tpda.d.ts:515

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

Defined in: driver/dist/session-BmR0tpda.d.ts:532

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:521

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

Defined in: driver/dist/session-BmR0tpda.d.ts:511

#### Parameters

##### options

`SemanticLocatorFilterOptions`

#### Returns

`SemanticLocator`

***

### first()

> **first**(): `SemanticLocator`

Defined in: driver/dist/session-BmR0tpda.d.ts:472

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.first`

***

### focus()

> **focus**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:522

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:491

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-BmR0tpda.d.ts:505

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

Defined in: driver/dist/session-BmR0tpda.d.ts:504

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

Defined in: driver/dist/session-BmR0tpda.d.ts:509

#### Parameters

##### testId

`string`

#### Returns

`SemanticLocator`

***

### getByText()

> **getByText**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-BmR0tpda.d.ts:508

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

Defined in: driver/dist/session-BmR0tpda.d.ts:495

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

Defined in: driver/dist/session-BmR0tpda.d.ts:487

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

Defined in: driver/dist/session-BmR0tpda.d.ts:473

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.last`

***

### locator()

> **locator**(`selector`): `SemanticLocator`

Defined in: driver/dist/session-BmR0tpda.d.ts:510

#### Parameters

##### selector

`string`

#### Returns

`SemanticLocator`

***

### nth()

> **nth**(`index`): `SemanticLocator`

Defined in: driver/dist/session-BmR0tpda.d.ts:474

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

Defined in: driver/dist/session-BmR0tpda.d.ts:476

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

Defined in: driver/dist/session-BmR0tpda.d.ts:530

Exact cells painted by this semantic recipient, never inferred from layout.

#### Returns

`Promise`\<`Observation`\<`SemanticPaintedRegion`\>\>

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:519

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

Defined in: driver/dist/session-BmR0tpda.d.ts:477

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

Defined in: driver/dist/session-BmR0tpda.d.ts:528

Production application viewport state, never emulator scrollback position.

#### Returns

`Promise`\<`Observation`\<`SemanticScrollState`\>\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:531

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<`SemanticValueObservation`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:526

#### Returns

`Promise`\<`SemanticValueObservation`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:500

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### type()

> **type**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:520

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

Defined in: driver/dist/session-BmR0tpda.d.ts:525

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:493

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:512

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-BmR0tpda.d.ts:482

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

Defined in: driver/dist/session-BmR0tpda.d.ts:489

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

Defined in: driver/dist/session-BmR0tpda.d.ts:503

#### Parameters

##### parent

`SemanticLocator`

#### Returns

`SemanticLocator`
