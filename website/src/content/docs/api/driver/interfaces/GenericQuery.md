---
title: "Interface: GenericQuery"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / GenericQuery

# Interface: GenericQuery

Defined in: [driver/src/selectors.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L51)

A grid query: literal or regex text plus optional style predicates.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [driver/src/selectors.ts:57](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L57)

***

### kind

> `readonly` **kind**: `"generic"`

Defined in: [driver/src/selectors.ts:52](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L52)

***

### occurrence?

> `readonly` `optional` **occurrence?**: `number`

Defined in: [driver/src/selectors.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L55)

1-based selection among all matches; strict mode applies when omitted.

***

### style?

> `readonly` `optional` **style?**: [`StylePredicates`](../stylepredicates/)

Defined in: [driver/src/selectors.ts:56](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L56)

***

### text

> `readonly` **text**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [driver/src/selectors.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L53)
