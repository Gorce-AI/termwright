---
title: "Function: parseRef()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / parseRef

# Function: parseRef()

> **parseRef**(`ref`): [`ParsedRef`](../../type-aliases/parsedref/) \| `null`

Defined in: [selectors.ts:90](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L90)

Parses a ref minted by `ResolvedTarget.ref`. Returns `null` for anything
that is not a ref — callers turn that into a typed error with context.

## Parameters

### ref

`string`

## Returns

[`ParsedRef`](../../type-aliases/parsedref/) \| `null`
