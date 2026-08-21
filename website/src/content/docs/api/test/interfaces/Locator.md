---
title: "Interface: Locator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / Locator

# Interface: Locator

Defined in: driver/dist/index.d.ts:470

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/index.d.ts:472

Human-readable form of the query, as it appears in error messages.

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<`ActionabilityExplanation`\>

Defined in: driver/dist/index.d.ts:494

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

Defined in: driver/dist/index.d.ts:504

Physical activation through the same planned device path as click and keyboard input.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### and()

> **and**(`other`): `Locator`

Defined in: driver/dist/index.d.ts:487

#### Parameters

##### other

`Locator`

#### Returns

`Locator`

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<`LocatorCellSnapshot`\>

Defined in: driver/dist/index.d.ts:521

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

`LocatorCellSnapshotOptions`

#### Returns

`Promise`\<`LocatorCellSnapshot`\>

***

### check()

> **check**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:505

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### click()

> **click**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:491

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: driver/dist/index.d.ts:490

#### Returns

`Promise`\<`number`\>

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:492

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### dragTo()

> **dragTo**(`target`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:497

#### Parameters

##### target

`Locator`

##### opts?

`LocatorDragOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### evaluateCondition()

> **evaluateCondition**(`condition`): `Promise`\<`ConditionResult`\>

Defined in: driver/dist/index.d.ts:511

Evaluate the same canonical condition model used by waits and ActionPlanner.

#### Parameters

##### condition

`Condition`

#### Returns

`Promise`\<`ConditionResult`\>

***

### extendedState()

> **extendedState**(): `Promise`\<`SemanticExtendedObject` \| `null`\>

Defined in: driver/dist/index.d.ts:527

Application-defined state, separate from portable semantic flags.

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:501

#### Parameters

##### text

`string`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### filter()

> **filter**(`options`): `Locator`

Defined in: driver/dist/index.d.ts:486

#### Parameters

##### options

`LocatorFilterOptions`

#### Returns

`Locator`

***

### first()

> **first**(): `Locator`

Defined in: driver/dist/index.d.ts:483

#### Returns

`Locator`

***

### focus()

> **focus**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:502

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/index.d.ts:513

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:476

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

###### exact?

`boolean`

#### Returns

`Locator`

***

### getByRole()

> **getByRole**(`role`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:475

Natural descendant query scoped to this locator.

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

`RoleLocatorOptions`

#### Returns

`Locator`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:480

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`ScreenTextLocatorOptions`

#### Returns

`Locator`

***

### getByTestId()

> **getByTestId**(`testId`): `Locator`

Defined in: driver/dist/index.d.ts:481

#### Parameters

##### testId

`string`

#### Returns

`Locator`

***

### getByText()

> **getByText**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:479

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`TextLocatorOptions`

#### Returns

`Locator`

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: driver/dist/index.d.ts:517

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

### hover()

> **hover**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:493

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### last()

> **last**(): `Locator`

Defined in: driver/dist/index.d.ts:484

#### Returns

`Locator`

***

### locator()

> **locator**(`selector`): `Locator`

Defined in: driver/dist/index.d.ts:482

#### Parameters

##### selector

`string`

#### Returns

`Locator`

***

### nth()

> **nth**(`index`): `Locator`

Defined in: driver/dist/index.d.ts:485

#### Parameters

##### index

`number`

#### Returns

`Locator`

***

### or()

> **or**(`other`): `Locator`

Defined in: driver/dist/index.d.ts:488

#### Parameters

##### other

`Locator`

#### Returns

`Locator`

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:499

#### Parameters

##### keys

`string`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### resolve()

> **resolve**(`opts?`): `Promise`\<`ResolvedTarget`\>

Defined in: driver/dist/index.d.ts:489

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ResolvedTarget`\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: driver/dist/index.d.ts:525

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<`string` \| `null`\>

Defined in: driver/dist/index.d.ts:524

Published semantic value, distinct from the accessible name/text.

#### Returns

`Promise`\<`string` \| `null`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: driver/dist/index.d.ts:522

#### Returns

`Promise`\<`string`\>

***

### type()

> **type**(`text`, `opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:500

#### Parameters

##### text

`string`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### uncheck()

> **uncheck**(`opts?`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:506

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/index.d.ts:515

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:507

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### wheel()

> **wheel**(`opts`): `Promise`\<`ActionReceipt`\>

Defined in: driver/dist/index.d.ts:498

#### Parameters

##### opts

`LocatorWheelOptions`

#### Returns

`Promise`\<`ActionReceipt`\>

***

### within()

> **within**(`parent`): `Locator`

Defined in: driver/dist/index.d.ts:473

#### Parameters

##### parent

`Locator`

#### Returns

`Locator`
