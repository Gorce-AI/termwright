---
title: "Interface: Locator"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / Locator

# Interface: Locator

Defined in: driver/dist/index.d.ts:375

## Properties

### description

> `readonly` **description**: `string`

Defined in: driver/dist/index.d.ts:377

Human-readable form of the query, as it appears in error messages.

## Methods

### activate()

> **activate**(`opts?`): `Promise`\<`ActivateReceipt`\>

Defined in: driver/dist/index.d.ts:404

Documented physical strategy (click, or focus+Enter); receipt says which.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ActivateReceipt`\>

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<`LocatorCellSnapshot`\>

Defined in: driver/dist/index.d.ts:417

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

`LocatorCellSnapshotOptions`

#### Returns

`Promise`\<`LocatorCellSnapshot`\>

***

### click()

> **click**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:383

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`void`\>

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: driver/dist/index.d.ts:382

#### Returns

`Promise`\<`number`\>

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:384

#### Parameters

##### opts?

`PointerOptions`

#### Returns

`Promise`\<`void`\>

***

### drag()

> **drag**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:386

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

Defined in: driver/dist/index.d.ts:385

#### Parameters

##### target

`Locator`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### extendedState()

> **extendedState**(): `Promise`\<`SemanticExtendedObject` \| `null`\>

Defined in: driver/dist/index.d.ts:421

Application-defined state, separate from portable semantic flags.

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### first()

> **first**(): `Locator`

Defined in: driver/dist/index.d.ts:379

#### Returns

`Locator`

***

### focusNode()

> **focusNode**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:402

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: driver/dist/index.d.ts:409

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: driver/dist/index.d.ts:413

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

Defined in: driver/dist/index.d.ts:380

#### Parameters

##### index

`number`

#### Returns

`Locator`

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:400

#### Parameters

##### keys

`string`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### resolve()

> **resolve**(`opts?`): `Promise`\<`ResolvedTarget`\>

Defined in: driver/dist/index.d.ts:381

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ResolvedTarget`\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: driver/dist/index.d.ts:419

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: driver/dist/index.d.ts:418

#### Returns

`Promise`\<`string`\>

***

### type()

> **type**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:401

#### Parameters

##### text

`string`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: driver/dist/index.d.ts:411

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:405

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### wheel()

> **wheel**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:396

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

Defined in: driver/dist/index.d.ts:378

#### Parameters

##### parent

`Locator`

#### Returns

`Locator`
