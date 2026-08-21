---
title: "Interface: RefQuery"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / RefQuery

# Interface: RefQuery

Defined in: [selectors.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L71)

A query that names one already-identified target. Unlike a re-query by role
and name, a ref stays unambiguous when two nodes look alike.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [selectors.ts:74](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L74)

***

### kind

> `readonly` **kind**: `"ref"`

Defined in: [selectors.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L72)

***

### ref

> `readonly` **ref**: [`ParsedRef`](../../type-aliases/parsedref/)

Defined in: [selectors.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L73)
