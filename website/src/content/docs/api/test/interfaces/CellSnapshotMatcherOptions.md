---
title: "Interface: CellSnapshotMatcherOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / CellSnapshotMatcherOptions

# Interface: CellSnapshotMatcherOptions

Defined in: [test/src/matchers.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L62)

Options for [TermwrightMatchers.toMatchCellSnapshot](../termwrightmatchers/#tomatchcellsnapshot).

## Extends

- [`PollOptions`](../polloptions/).[`CellSnapshotOptions`](../cellsnapshotoptions/)

## Properties

### attributes?

> `readonly` `optional` **attributes?**: `boolean`

Defined in: [test/src/cells.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L16)

Append the styled-run legend. Default false.

#### Inherited from

[`CellSnapshotOptions`](../cellsnapshotoptions/).[`attributes`](../cellsnapshotoptions/#attributes)

***

### box?

> `readonly` `optional` **box?**: `boolean`

Defined in: [test/src/cells.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L18)

Draw the frame with the viewport size. Default true.

#### Inherited from

[`CellSnapshotOptions`](../cellsnapshotoptions/).[`box`](../cellsnapshotoptions/#box)

***

### palette?

> `readonly` `optional` **palette?**: [`ColorPalette`](../colorpalette/)

Defined in: [test/src/cells.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L22)

Names palette colors in the legend, so CI and laptop agree.

#### Inherited from

[`CellSnapshotOptions`](../cellsnapshotoptions/).[`palette`](../cellsnapshotoptions/#palette)

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [test/src/matchers.ts:48](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L48)

Milliseconds to keep re-probing. Defaults to the `expect` timeout class.

#### Inherited from

[`PollOptions`](../polloptions/).[`timeout`](../polloptions/#timeout)

***

### trimTrailingRows?

> `readonly` `optional` **trimTrailingRows?**: `boolean`

Defined in: [test/src/cells.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L20)

Drop empty rows at the bottom of the viewport. Default true.

#### Inherited from

[`CellSnapshotOptions`](../cellsnapshotoptions/).[`trimTrailingRows`](../cellsnapshotoptions/#trimtrailingrows)
