---
title: "Interface: SemanticLocator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticLocator

# Interface: SemanticLocator

Defined in: [driver/src/api.ts:600](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L600)

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

Defined in: [driver/src/api.ts:559](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L559)

Human-readable form of the query, as it appears in error messages.

#### Inherited from

[`ScreenLocator`](../screenlocator/).[`description`](../screenlocator/#description)

***

### domain

> `readonly` **domain**: `"semantic"`

Defined in: [driver/src/api.ts:557](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L557)

#### Inherited from

`LocatorBase.domain`

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

Defined in: [driver/src/api.ts:633](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L633)

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

Defined in: [driver/src/api.ts:657](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L657)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### and()

> **and**(`other`): `SemanticLocator`

Defined in: [driver/src/api.ts:563](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L563)

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

Defined in: [driver/src/api.ts:595](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L595)

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

Defined in: [driver/src/api.ts:658](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L658)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### checkpoint()

> **checkpoint**(): [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:570](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L570)

Current committed observation used to arm race-free custom waits.

#### Returns

[`ObservationStamp`](../observationstamp/)

#### Inherited from

`LocatorBase.checkpoint`

***

### click()

> **click**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:577](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L577)

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

Defined in: [driver/src/api.ts:568](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L568)

#### Returns

`Promise`\<`number`\>

#### Inherited from

`LocatorBase.count`

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:578](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L578)

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

Defined in: [driver/src/api.ts:580](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L580)

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

Defined in: [driver/src/api.ts:629](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L629)

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

Defined in: [driver/src/api.ts:676](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L676)

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:652](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L652)

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

Defined in: [driver/src/api.ts:610](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L610)

#### Parameters

##### options

[`SemanticLocatorFilterOptions`](../semanticlocatorfilteroptions/)

#### Returns

`SemanticLocator`

***

### first()

> **first**(): `SemanticLocator`

Defined in: [driver/src/api.ts:560](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L560)

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.first`

***

### focus()

> **focus**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:656](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L656)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [driver/src/api.ts:587](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L587)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

#### Inherited from

`LocatorBase.geometry`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: [driver/src/api.ts:603](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L603)

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

Defined in: [driver/src/api.ts:602](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L602)

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

Defined in: [driver/src/api.ts:608](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L608)

#### Parameters

##### testId

`string`

#### Returns

`SemanticLocator`

***

### getByText()

> **getByText**(`text`, `opts?`): `SemanticLocator`

Defined in: [driver/src/api.ts:607](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L607)

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

Defined in: [driver/src/api.ts:591](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L591)

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

Defined in: [driver/src/api.ts:579](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L579)

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

Defined in: [driver/src/api.ts:561](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L561)

#### Returns

`SemanticLocator`

#### Inherited from

`LocatorBase.last`

***

### locator()

> **locator**(`selector`): `SemanticLocator`

Defined in: [driver/src/api.ts:609](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L609)

#### Parameters

##### selector

`string`

#### Returns

`SemanticLocator`

***

### nth()

> **nth**(`index`): `SemanticLocator`

Defined in: [driver/src/api.ts:562](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L562)

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

Defined in: [driver/src/api.ts:564](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L564)

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

Defined in: [driver/src/api.ts:670](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L670)

Exact cells painted by this semantic recipient, never inferred from layout.

#### Returns

`Promise`\<[`Observation`](../../type-aliases/observation/)\<`SemanticPaintedRegion`\>\>

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:647](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L647)

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

Defined in: [driver/src/api.ts:567](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L567)

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

Defined in: [driver/src/api.ts:664](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L664)

Production application viewport state, never emulator scrollback position.

#### Returns

`Promise`\<[`Observation`](../../type-aliases/observation/)\<`SemanticScrollState`\>\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: [driver/src/api.ts:675](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L675)

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<[`SemanticValueObservation`](../../type-aliases/semanticvalueobservation/)\>

Defined in: [driver/src/api.ts:660](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L660)

#### Returns

`Promise`\<[`SemanticValueObservation`](../../type-aliases/semanticvalueobservation/)\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: [driver/src/api.ts:596](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L596)

#### Returns

`Promise`\<`string`\>

#### Inherited from

`LocatorBase.textContent`

***

### type()

> **type**(`text`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:648](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L648)

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

Defined in: [driver/src/api.ts:659](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L659)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [driver/src/api.ts:589](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L589)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

#### Inherited from

`LocatorBase.visibility`

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:611](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L611)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:572](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L572)

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

Defined in: [driver/src/api.ts:584](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L584)

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

Defined in: [driver/src/api.ts:601](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L601)

#### Parameters

##### parent

`SemanticLocator`

#### Returns

`SemanticLocator`
