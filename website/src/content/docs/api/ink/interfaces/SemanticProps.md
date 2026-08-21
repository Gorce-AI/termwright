---
title: "Interface: SemanticProps"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / SemanticProps

# Interface: SemanticProps

Defined in: [ink/src/semantic.tsx:21](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/semantic.tsx#L21)

[Semantic](../../functions/semantic/) props: the annotation, plus the element it describes.

## Extends

- [`InkSemanticAnnotation`](../inksemanticannotation/)

## Properties

### actions?

> `readonly` `optional` **actions?**: readonly (`"focus"` \| `"activate"` \| `"toggle"` \| `"setValue"` \| `"scroll"` \| `"select"` \| `"expand"`)[]

Defined in: [ink/src/types.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L19)

Descriptive input intent. Actions still travel through the terminal.

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`actions`](../inksemanticannotation/#actions)

***

### children

> `readonly` **children**: [`SemanticChild`](../../type-aliases/semanticchild/)

Defined in: [ink/src/semantic.tsx:29](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/semantic.tsx#L29)

Exactly one element that accepts a ref — in practice an Ink `<Box>`.

`<Text>` does not take a ref, so wrapping one annotates nothing. Wrap the
text in a `<Box>` instead, which is what giving it a shape would require
anyway.

***

### describedBy?

> `readonly` `optional` **describedBy?**: readonly `RefObject`\<`DOMElement` \| `null`\>[]

Defined in: [ink/src/types.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L21)

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`describedBy`](../inksemanticannotation/#describedby)

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [ink/src/types.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L14)

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`description`](../inksemanticannotation/#description)

***

### extended?

> `readonly` `optional` **extended?**: `SemanticExtendedObject`

Defined in: [ink/src/types.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L17)

Application-domain JSON; never merged into portable framework state.

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`extended`](../inksemanticannotation/#extended)

***

### labelledBy?

> `readonly` `optional` **labelledBy?**: readonly `RefObject`\<`DOMElement` \| `null`\>[]

Defined in: [ink/src/types.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L20)

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`labelledBy`](../inksemanticannotation/#labelledby)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [ink/src/types.ts:13](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L13)

Accessible name used by `getByRole(role, { name })`.

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`name`](../inksemanticannotation/#name)

***

### role?

> `readonly` `optional` **role?**: `"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

Defined in: [ink/src/types.ts:11](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L11)

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`role`](../inksemanticannotation/#role)

***

### testId?

> `readonly` `optional` **testId?**: `string`

Defined in: [ink/src/types.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L15)

#### Inherited from

[`InkSemanticAnnotation`](../inksemanticannotation/).[`testId`](../inksemanticannotation/#testid)
