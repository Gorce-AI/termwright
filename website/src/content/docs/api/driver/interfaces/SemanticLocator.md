---
title: "Interface: SemanticLocator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticLocator

# Interface: SemanticLocator

Defined in: [driver/src/api.ts:619](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L619)

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

- `LocatorBase`\<`"semantic"`\>

## Properties

### description

> `readonly` **description**: `string`

Defined in: [driver/src/api.ts:583](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L583)

Human-readable form of the query, as it appears in error messages.

#### Inherited from

[`ScreenLocator`](../screenlocator/).[`description`](../screenlocator/#description)

***

### domain

> `readonly` **domain**: `"semantic"`

Defined in: [driver/src/api.ts:581](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L581)

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

Defined in: [driver/src/api.ts:646](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L646)

#### Parameters

##### action

`"focus"` \| `"click"` \| `"double-click"` \| `"hover"` \| `"activate"` \| `"press"` \| `"type"` \| `"fill"` \| `"check"` \| `"uncheck"`

##### opts?

[`PointerOptions`](../pointeroptions/) & `object`

#### Returns

`Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

***

### activate()

> **activate**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:670](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L670)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### and()

> **and**(`other`): `SemanticLocator`

Defined in: [driver/src/api.ts:587](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L587)

#### Parameters

##### other

`SemanticLocator`

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.and`

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

Defined in: [driver/src/api.ts:614](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L614)

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

[`LocatorCellSnapshotOptions`](../locatorcellsnapshotoptions/)

#### Returns

`Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

#### Inherited from

`LocatorBase.cellSnapshot`

***

### check()

> **check**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:671](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L671)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### checkpoint()

> **checkpoint**(): [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:594](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L594)

Current committed observation used to arm race-free custom waits.

#### Returns

[`ObservationStamp`](../observationstamp/)

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:601](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L601)

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

Defined in: [driver/src/api.ts:592](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L592)

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:602](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L602)

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

Defined in: [driver/src/api.ts:604](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L604)

#### Parameters

##### target

`SemanticLocator`

##### opts?

[`LocatorDragOptions`](../locatordragoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.dragTo`

***

### evaluateCondition()

> **evaluateCondition**(`condition`, `opts?`): `Promise`\<[`ConditionResult`](../conditionresult/)\>

Defined in: [driver/src/api.ts:645](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L645)

#### Parameters

##### condition

[`Condition`](../../type-aliases/condition/)

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ConditionResult`](../conditionresult/)\>

***

### extendedState()

> **extendedState**(): `Promise`\<`SemanticExtendedObject` \| `null`\>

Defined in: [driver/src/api.ts:683](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L683)

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:665](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L665)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### filter()

> **filter**(`options`): `SemanticLocator`

Defined in: [driver/src/api.ts:626](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L626)

#### Parameters

##### options

[`SemanticLocatorFilterOptions`](../semanticlocatorfilteroptions/)

#### Returns

`SemanticLocator`

***

### first()

> **first**(): `SemanticLocator`

Defined in: [driver/src/api.ts:584](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L584)

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.first`

***

### focus()

> **focus**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:669](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L669)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [driver/src/api.ts:608](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L608)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: [driver/src/api.ts:622](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L622)

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

Defined in: [driver/src/api.ts:621](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L621)

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

[`RoleLocatorOptions`](../rolelocatoroptions/)

#### Returns

`SemanticLocator`

***

### getByTestId()

> **getByTestId**(`testId`): `SemanticLocator`

Defined in: [driver/src/api.ts:624](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L624)

#### Parameters

##### testId

`string`

#### Returns

`SemanticLocator`

***

### getByText()

> **getByText**(`text`, `opts?`): `SemanticLocator`

Defined in: [driver/src/api.ts:623](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L623)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`TextLocatorOptions`](../textlocatoroptions/)

#### Returns

`SemanticLocator`

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: [driver/src/api.ts:612](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L612)

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

Defined in: [driver/src/api.ts:603](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L603)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.hover`

***

### last()

> **last**(): `SemanticLocator`

Defined in: [driver/src/api.ts:585](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L585)

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.last`

***

### locator()

> **locator**(`selector`): `SemanticLocator`

Defined in: [driver/src/api.ts:625](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L625)

#### Parameters

##### selector

`string`

#### Returns

`SemanticLocator`

***

### nth()

> **nth**(`index`): `SemanticLocator`

Defined in: [driver/src/api.ts:586](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L586)

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

Defined in: [driver/src/api.ts:588](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L588)

#### Parameters

##### other

`SemanticLocator`

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.or`

***

### paintedRegion()

> **paintedRegion**(): `Promise`\<[`Observation`](../../type-aliases/observation/)\<`SemanticPaintedRegion`\>\>

Defined in: [driver/src/api.ts:679](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L679)

Exact cells painted by this semantic recipient, never inferred from layout.

#### Returns

`Promise`\<[`Observation`](../../type-aliases/observation/)\<`SemanticPaintedRegion`\>\>

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:660](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L660)

#### Parameters

##### keys

`string`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### resolve()

> **resolve**(`opts?`): `Promise`\<[`ResolvedTarget`](../resolvedtarget/)\<`"semantic"`\>\>

Defined in: [driver/src/api.ts:591](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L591)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ResolvedTarget`](../resolvedtarget/)\<`"semantic"`\>\>

#### Inherited from

`LocatorBase.resolve`

***

### semanticScroll()

> **semanticScroll**(): `Promise`\<[`Observation`](../../type-aliases/observation/)\<`SemanticScrollState`\>\>

Defined in: [driver/src/api.ts:675](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L675)

Production application viewport state, never emulator scrollback position.

#### Returns

`Promise`\<[`Observation`](../../type-aliases/observation/)\<`SemanticScrollState`\>\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: [driver/src/api.ts:682](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L682)

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<[`SemanticValueObservation`](../../type-aliases/semanticvalueobservation/)\>

Defined in: [driver/src/api.ts:673](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L673)

#### Returns

`Promise`\<[`SemanticValueObservation`](../../type-aliases/semanticvalueobservation/)\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: [driver/src/api.ts:615](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L615)

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### type()

> **type**(`text`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:661](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L661)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### uncheck()

> **uncheck**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:672](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L672)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [driver/src/api.ts:610](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L610)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:627](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L627)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:596](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L596)

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

Defined in: [driver/src/api.ts:605](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L605)

#### Parameters

##### opts

[`LocatorWheelOptions`](../locatorwheeloptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

#### Inherited from

`LocatorBase.wheel`

***

### within()

> **within**(`parent`): `SemanticLocator`

Defined in: [driver/src/api.ts:620](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L620)

#### Parameters

##### parent

`SemanticLocator`

#### Returns

`SemanticLocator`
