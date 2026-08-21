---
title: "Interface: GenericQuery"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / GenericQuery

# Interface: GenericQuery

Defined in: [selectors.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L53)

A grid query: literal or regex text plus optional style predicates.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [selectors.ts:59](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L59)

***

### kind

> `readonly` **kind**: `"generic"`

Defined in: [selectors.ts:54](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L54)

***

### occurrence?

> `readonly` `optional` **occurrence?**: `number`

Defined in: [selectors.ts:57](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L57)

1-based selection among all matches; strict mode applies when omitted.

***

### style?

> `readonly` `optional` **style?**: [`StylePredicates`](../stylepredicates/)

Defined in: [selectors.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L58)

***

### text

> `readonly` **text**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [selectors.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L55)
