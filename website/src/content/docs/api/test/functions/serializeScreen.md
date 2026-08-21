---
title: "Function: serializeScreen()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / serializeScreen

# Function: serializeScreen()

> **serializeScreen**(`screen`, `options?`): `string`

Defined in: [test/src/cells.ts:40](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/cells.ts#L40)

Renders the visible grid.

## Parameters

### screen

`Pick`\<`ScreenSnapshot`, `"columns"` \| `"rows"` \| `"cell"`\>

### options?

[`CellSnapshotOptions`](../../interfaces/cellsnapshotoptions/) = `{}`

## Returns

`string`

## Example

```
┌─ 20×3 ─────────────┐
│Permission required │
│  [Approve]  Reject │
└────────────────────┘
```
