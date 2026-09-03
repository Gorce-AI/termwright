---
title: "Interface: SemanticLocator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SemanticLocator

# Interface: SemanticLocator

Defined in: driver/dist/session-DOkKra9W.d.ts:535

## Extends

- `LocatorBase`\<`"semantic"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/session-DOkKra9W.d.ts:504

Human-readable form of the query, as it appears in error messages.

#### Inherited from

[`ScreenLocator`](../screenlocator/).[`description`](../screenlocator/#description)

***

### domain

> `readonly` **domain**: `"semantic"`

Defined in: driver/dist/session-DOkKra9W.d.ts:502

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<`ActionabilityExplanation`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:549

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

Defined in: driver/dist/session-DOkKra9W.d.ts:556

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### and()

> **and**(`other`): `SemanticLocator`

Defined in: driver/dist/session-DOkKra9W.d.ts:508

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

Defined in: driver/dist/session-DOkKra9W.d.ts:532

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

Defined in: driver/dist/session-DOkKra9W.d.ts:557

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### checkpoint()

> **checkpoint**(): `ObservationStamp`

Defined in: driver/dist/session-DOkKra9W.d.ts:513

Current committed observation used to arm race-free custom waits.

#### Returns

`ObservationStamp`

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:518

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

Defined in: driver/dist/session-DOkKra9W.d.ts:511

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:519

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

Defined in: driver/dist/session-DOkKra9W.d.ts:521

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

Defined in: driver/dist/session-DOkKra9W.d.ts:548

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

Defined in: driver/dist/session-DOkKra9W.d.ts:565

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:554

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

Defined in: driver/dist/session-DOkKra9W.d.ts:544

#### Parameters

##### options

`SemanticLocatorFilterOptions`

#### Returns

`SemanticLocator`

***

### first()

> **first**(): `SemanticLocator`

Defined in: driver/dist/session-DOkKra9W.d.ts:505

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.first`

***

### focus()

> **focus**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:555

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:524

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-DOkKra9W.d.ts:538

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

Defined in: driver/dist/session-DOkKra9W.d.ts:537

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

Defined in: driver/dist/session-DOkKra9W.d.ts:542

#### Parameters

##### testId

`string`

#### Returns

`SemanticLocator`

***

### getByText()

> **getByText**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-DOkKra9W.d.ts:541

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

Defined in: driver/dist/session-DOkKra9W.d.ts:528

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

Defined in: driver/dist/session-DOkKra9W.d.ts:520

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

Defined in: driver/dist/session-DOkKra9W.d.ts:506

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.last`

***

### locator()

> **locator**(`selector`): `SemanticLocator`

Defined in: driver/dist/session-DOkKra9W.d.ts:543

#### Parameters

##### selector

`string`

#### Returns

`SemanticLocator`

***

### nth()

> **nth**(`index`): `SemanticLocator`

Defined in: driver/dist/session-DOkKra9W.d.ts:507

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

Defined in: driver/dist/session-DOkKra9W.d.ts:509

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

Defined in: driver/dist/session-DOkKra9W.d.ts:563

Exact cells painted by this semantic recipient, never inferred from layout.

#### Returns

`Promise`\<`Observation`\<`SemanticPaintedRegion`\>\>

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:552

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

Defined in: driver/dist/session-DOkKra9W.d.ts:510

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

Defined in: driver/dist/session-DOkKra9W.d.ts:561

Production application viewport state, never emulator scrollback position.

#### Returns

`Promise`\<`Observation`\<`SemanticScrollState`\>\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:564

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<`SemanticValueObservation`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:559

#### Returns

`Promise`\<`SemanticValueObservation`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:533

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### type()

> **type**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:553

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

Defined in: driver/dist/session-DOkKra9W.d.ts:558

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:526

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:545

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:515

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

Defined in: driver/dist/session-DOkKra9W.d.ts:522

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

Defined in: driver/dist/session-DOkKra9W.d.ts:536

#### Parameters

##### parent

`SemanticLocator`

#### Returns

`SemanticLocator`
