---
title: "Interface: CellSnapshotOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / CellSnapshotOptions

# Interface: CellSnapshotOptions

Defined in: [test/src/cells.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L14)

Options for [serializeScreen](../../functions/serializescreen/).

## Extended by

- [`CellSnapshotMatcherOptions`](../cellsnapshotmatcheroptions/)

## Properties

### attributes?

> `readonly` `optional` **attributes?**: `boolean`

Defined in: [test/src/cells.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L16)

Append the styled-run legend. Default false.

***

### box?

> `readonly` `optional` **box?**: `boolean`

Defined in: [test/src/cells.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L18)

Draw the frame with the viewport size. Default true.

***

### palette?

> `readonly` `optional` **palette?**: [`ColorPalette`](../colorpalette/)

Defined in: [test/src/cells.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L22)

Names palette colors in the legend, so CI and laptop agree.

***

### trimTrailingRows?

> `readonly` `optional` **trimTrailingRows?**: `boolean`

Defined in: [test/src/cells.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L20)

Drop empty rows at the bottom of the viewport. Default true.
