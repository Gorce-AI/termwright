---
title: "Interface: Locator"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Locator

# Interface: Locator

Defined in: [driver/src/api.ts:486](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L486)

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

## Properties

### description

> `readonly` **description**: `string`

Defined in: [driver/src/api.ts:488](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L488)

Human-readable form of the query, as it appears in error messages.

## Methods

### actionability()

> **actionability**(`action`, `opts?`): `Promise`\<[`ActionabilityExplanation`](../actionabilityexplanation/)\>

Defined in: [driver/src/api.ts:513](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L513)

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

Defined in: [driver/src/api.ts:524](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L524)

Physical activation through the same planned device path as click and keyboard input.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### and()

> **and**(`other`): `Locator`

Defined in: [driver/src/api.ts:502](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L502)

#### Parameters

##### other

`Locator`

#### Returns

`Locator`

***

### cellSnapshot()

> **cellSnapshot**(`opts?`): `Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

Defined in: [driver/src/api.ts:539](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L539)

Atomic cells inside this locator's qualified rectangle.

#### Parameters

##### opts?

[`LocatorCellSnapshotOptions`](../locatorcellsnapshotoptions/)

#### Returns

`Promise`\<[`LocatorCellSnapshot`](../locatorcellsnapshot/)\>

***

### check()

> **check**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:525](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L525)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### click()

> **click**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:510](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L510)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: [driver/src/api.ts:507](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L507)

#### Returns

`Promise`\<`number`\>

***

### doubleClick()

> **doubleClick**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:511](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L511)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### dragTo()

> **dragTo**(`target`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:517](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L517)

#### Parameters

##### target

`Locator`

##### opts?

[`LocatorDragOptions`](../locatordragoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### evaluateCondition()

> **evaluateCondition**(`condition`): `Promise`\<[`ConditionResult`](../conditionresult/)\>

Defined in: [driver/src/api.ts:531](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L531)

Evaluate the same canonical condition model used by waits and ActionPlanner.

#### Parameters

##### condition

[`Condition`](../../type-aliases/condition/)

#### Returns

`Promise`\<[`ConditionResult`](../conditionresult/)\>

***

### extendedState()

> **extendedState**(): `Promise`\<`SemanticExtendedObject` \| `null`\>

Defined in: [driver/src/api.ts:545](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L545)

Application-defined state, separate from portable semantic flags.

#### Returns

`Promise`\<`SemanticExtendedObject` \| `null`\>

***

### fill()

> **fill**(`text`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:521](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L521)

#### Parameters

##### text

`string`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### filter()

> **filter**(`options`): `Locator`

Defined in: [driver/src/api.ts:501](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L501)

#### Parameters

##### options

[`LocatorFilterOptions`](../locatorfilteroptions/)

#### Returns

`Locator`

***

### first()

> **first**(): `Locator`

Defined in: [driver/src/api.ts:498](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L498)

#### Returns

`Locator`

***

### focus()

> **focus**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:522](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L522)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### geometry()

> **geometry**(): `Promise`\<`LocatorGeometry`\>

Defined in: [driver/src/api.ts:533](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L533)

Atomic, evidence-qualified geometry. Never invents a rectangle.

#### Returns

`Promise`\<`LocatorGeometry`\>

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `Locator`

Defined in: [driver/src/api.ts:493](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L493)

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

Defined in: [driver/src/api.ts:492](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L492)

Natural descendant query scoped to this locator.

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

[`RoleLocatorOptions`](../rolelocatoroptions/)

#### Returns

`Locator`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `Locator`

Defined in: [driver/src/api.ts:495](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L495)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`ScreenTextLocatorOptions`](../screentextlocatoroptions/)

#### Returns

`Locator`

***

### getByTestId()

> **getByTestId**(`testId`): `Locator`

Defined in: [driver/src/api.ts:496](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L496)

#### Parameters

##### testId

`string`

#### Returns

`Locator`

***

### getByText()

> **getByText**(`text`, `opts?`): `Locator`

Defined in: [driver/src/api.ts:494](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L494)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`TextLocatorOptions`](../textlocatoroptions/)

#### Returns

`Locator`

***

### hitTest()

> **hitTest**(`opts?`): `Promise`\<`PointerHitTest`\>

Defined in: [driver/src/api.ts:537](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L537)

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

> **hover**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:512](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L512)

#### Parameters

##### opts?

[`PointerOptions`](../pointeroptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### last()

> **last**(): `Locator`

Defined in: [driver/src/api.ts:499](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L499)

#### Returns

`Locator`

***

### locator()

> **locator**(`selector`): `Locator`

Defined in: [driver/src/api.ts:497](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L497)

#### Parameters

##### selector

`string`

#### Returns

`Locator`

***

### nth()

> **nth**(`index`): `Locator`

Defined in: [driver/src/api.ts:500](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L500)

#### Parameters

##### index

`number`

#### Returns

`Locator`

***

### or()

> **or**(`other`): `Locator`

Defined in: [driver/src/api.ts:503](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L503)

#### Parameters

##### other

`Locator`

#### Returns

`Locator`

***

### press()

> **press**(`keys`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:519](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L519)

#### Parameters

##### keys

`string`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### resolve()

> **resolve**(`opts?`): `Promise`\<[`ResolvedTarget`](../resolvedtarget/)\>

Defined in: [driver/src/api.ts:506](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L506)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ResolvedTarget`](../resolvedtarget/)\>

***

### semanticState()

> **semanticState**(): `Promise`\<`SemanticState` \| `null`\>

Defined in: [driver/src/api.ts:543](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L543)

#### Returns

`Promise`\<`SemanticState` \| `null`\>

***

### semanticValue()

> **semanticValue**(): `Promise`\<`string` \| `null`\>

Defined in: [driver/src/api.ts:542](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L542)

Published semantic value, distinct from the accessible name/text.

#### Returns

`Promise`\<`string` \| `null`\>

***

### textContent()

> **textContent**(): `Promise`\<`string`\>

Defined in: [driver/src/api.ts:540](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L540)

#### Returns

`Promise`\<`string`\>

***

### type()

> **type**(`text`, `opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:520](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L520)

#### Parameters

##### text

`string`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### uncheck()

> **uncheck**(`opts?`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:526](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L526)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### visibility()

> **visibility**(): `Promise`\<`LocatorVisibility`\>

Defined in: [driver/src/api.ts:535](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L535)

Attached/displayed/viewport facts without collapsing unknown to false.

#### Returns

`Promise`\<`LocatorVisibility`\>

***

### waitFor()

> **waitFor**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:529](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L529)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### wheel()

> **wheel**(`opts`): `Promise`\<[`ActionReceipt`](../actionreceipt/)\>

Defined in: [driver/src/api.ts:518](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L518)

#### Parameters

##### opts

[`LocatorWheelOptions`](../locatorwheeloptions/)

#### Returns

`Promise`\<[`ActionReceipt`](../actionreceipt/)\>

***

### within()

> **within**(`parent`): `Locator`

Defined in: [driver/src/api.ts:490](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L490)

#### Parameters

##### parent

`Locator`

#### Returns

`Locator`
