---
title: "Interface: RefQuery"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / RefQuery

# Interface: RefQuery

Defined in: [driver/src/selectors.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L69)

A query that names one already-identified target. Unlike a re-query by role
and name, a ref stays unambiguous when two nodes look alike.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [driver/src/selectors.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L72)

***

### kind

> `readonly` **kind**: `"ref"`

Defined in: [driver/src/selectors.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L70)

***

### ref

> `readonly` **ref**: [`ParsedRef`](../../type-aliases/parsedref/)

Defined in: [driver/src/selectors.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L71)
