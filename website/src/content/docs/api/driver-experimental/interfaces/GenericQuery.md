---
title: "Interface: GenericQuery"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / GenericQuery

# Interface: GenericQuery

Defined in: [selectors.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L51)

A grid query: literal or regex text plus optional style predicates.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [selectors.ts:57](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L57)

***

### kind

> `readonly` **kind**: `"generic"`

Defined in: [selectors.ts:52](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L52)

***

### occurrence?

> `readonly` `optional` **occurrence?**: `number`

Defined in: [selectors.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L55)

1-based selection among all matches; strict mode applies when omitted.

***

### style?

> `readonly` `optional` **style?**: [`StylePredicates`](../stylepredicates/)

Defined in: [selectors.ts:56](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L56)

***

### text

> `readonly` **text**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [selectors.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L53)
