---
title: "Interface: SemanticStep"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / SemanticStep

# Interface: SemanticStep

Defined in: [selectors.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L21)

One compound selector in a descendant chain.

## Properties

### classes

> `readonly` **classes**: readonly `string`[]

Defined in: [selectors.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L24)

***

### frameworkType?

> `readonly` `optional` **frameworkType?**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [selectors.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L31)

Matches the framework's own widget type, the only way to tell generics apart.

***

### label?

> `readonly` `optional` **label?**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [selectors.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L29)

Matches against the node's computed label (`labelledBy`, else `name`).

***

### name?

> `readonly` `optional` **name?**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [selectors.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L25)

***

### role?

> `readonly` `optional` **role?**: `"generic"` \| `"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"`

Defined in: [selectors.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L22)

***

### state

> `readonly` **state**: `Readonly`\<`Partial`\<`SemanticState`\>\>

Defined in: [selectors.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L32)

***

### testId?

> `readonly` `optional` **testId?**: `string`

Defined in: [selectors.ts:23](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L23)

***

### text?

> `readonly` `optional` **text?**: [`TextMatcher`](../../type-aliases/textmatcher/)

Defined in: [selectors.ts:27](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L27)

Matches against `name`, `value` and the labels a node is labelled by.
