---
title: "Interface: TermwrightMatchers\\<R\\>"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightMatchers

# Interface: TermwrightMatchers\<R\>

Defined in: [test/src/matchers.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L80)

The matchers this package adds to `expect`.

## Type Parameters

### R

`R` = `unknown`

## Methods

### toBeAttached()

> **toBeAttached**(`options?`): `R`

Defined in: [test/src/matchers.ts:83](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L83)

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toBeDetached()

> **toBeDetached**(`options?`): `R`

Defined in: [test/src/matchers.ts:84](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L84)

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toBeDisplayed()

> **toBeDisplayed**(`options?`): `R`

Defined in: [test/src/matchers.ts:85](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L85)

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toBeFocused()

> **toBeFocused**(`options?`): `R`

Defined in: [test/src/matchers.ts:93](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L93)

The locator resolves to the node carrying `state.focused`.

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toBeHidden()

> **toBeHidden**(`options?`): `R`

Defined in: [test/src/matchers.ts:86](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L86)

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toBeInViewport()

> **toBeInViewport**(`options?`): `R`

Defined in: [test/src/matchers.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L88)

#### Parameters

##### options?

[`PollOptions`](../polloptions/) & `object`

#### Returns

`R`

***

### toBeOffscreen()

> **toBeOffscreen**(`options?`): `R`

Defined in: [test/src/matchers.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L87)

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toBeVisible()

> **toBeVisible**(`options?`): `R`

Defined in: [test/src/matchers.ts:82](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L82)

The locator resolves to a node that is on screen and not hidden.

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toHaveBounds()

> **toHaveBounds**(`expected`, `options?`): `R`

Defined in: [test/src/matchers.ts:90](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L90)

#### Parameters

##### expected

`BoundsExpectation`

##### options?

[`PollOptions`](../polloptions/) & `object`

#### Returns

`R`

***

### toHaveExtendedState()

> **toHaveExtendedState**(`expected`, `options?`): `R`

Defined in: [test/src/matchers.ts:97](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L97)

Every listed application-domain key deep-equals the expected JSON value.

#### Parameters

##### expected

`SemanticExtendedObject`

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toHaveLogged()

> **toHaveLogged**(`query`, `options?`): `R`

Defined in: [test/src/matchers.ts:105](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L105)

The program logged an entry matching the query.

#### Parameters

##### query

[`LogQuery`](../logquery/)

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toHaveSpatialRelation()

> **toHaveSpatialRelation**(`expected`, `options?`): `R`

Defined in: [test/src/matchers.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L91)

#### Parameters

##### expected

`SpatialRelationExpectation`

##### options?

[`PollOptions`](../polloptions/) & `object`

#### Returns

`R`

***

### toHaveState()

> **toHaveState**(`expected`, `options?`): `R`

Defined in: [test/src/matchers.ts:95](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L95)

Every listed state key holds; unlisted keys are not constrained.

#### Parameters

##### expected

`Partial`\<`SemanticState`\>

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`

***

### toHaveText()

> **toHaveText**(`expected`, `options?`): `R`

Defined in: [test/src/matchers.ts:99](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L99)

Accessible text of a locator, or the visible grid of a terminal.

#### Parameters

##### expected

`string` \| `RegExp`

##### options?

[`TextMatcherOptions`](../textmatcheroptions/)

#### Returns

`R`

***

### toMatchCellSnapshot()

> **toMatchCellSnapshot**(`expected?`, `options?`): `R`

Defined in: [test/src/matchers.ts:101](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L101)

Framed rendering of the visible grid, inline or from `__snapshots__`.

#### Parameters

##### expected?

`string`

##### options?

[`CellSnapshotMatcherOptions`](../cellsnapshotmatcheroptions/)

#### Returns

`R`

***

### toMatchSemanticSnapshot()

> **toMatchSemanticSnapshot**(`expected?`, `options?`): `R`

Defined in: [test/src/matchers.ts:103](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L103)

Semantic tree as YAML, matched partially (`/CONTRACTS.md` §YAML).

#### Parameters

##### expected?

`string`

##### options?

[`SemanticSnapshotMatcherOptions`](../semanticsnapshotmatcheroptions/)

#### Returns

`R`

***

### toReceivePointerEvents()

> **toReceivePointerEvents**(`options?`): `R`

Defined in: [test/src/matchers.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L89)

#### Parameters

##### options?

[`PollOptions`](../polloptions/)

#### Returns

`R`
