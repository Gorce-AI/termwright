---
title: "Interface: InkSemanticAnnotation"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / InkSemanticAnnotation

# Interface: InkSemanticAnnotation

Defined in: [ink/src/types.ts:10](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L10)

Intent an application knows and the Ink host tree cannot derive.

## Extended by

- [`SemanticProps`](../semanticprops/)

## Properties

### actions?

> `readonly` `optional` **actions?**: readonly (`"focus"` \| `"activate"` \| `"toggle"` \| `"setValue"` \| `"scroll"` \| `"select"` \| `"expand"`)[]

Defined in: [ink/src/types.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L19)

Descriptive input intent. Actions still travel through the terminal.

***

### describedBy?

> `readonly` `optional` **describedBy?**: readonly `RefObject`\<`DOMElement` \| `null`\>[]

Defined in: [ink/src/types.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L21)

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [ink/src/types.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L14)

***

### extended?

> `readonly` `optional` **extended?**: `SemanticExtendedObject`

Defined in: [ink/src/types.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L17)

Application-domain JSON; never merged into portable framework state.

***

### labelledBy?

> `readonly` `optional` **labelledBy?**: readonly `RefObject`\<`DOMElement` \| `null`\>[]

Defined in: [ink/src/types.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L20)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [ink/src/types.ts:13](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L13)

Accessible name used by `getByRole(role, { name })`.

***

### role?

> `readonly` `optional` **role?**: `"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

Defined in: [ink/src/types.ts:11](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L11)

***

### testId?

> `readonly` `optional` **testId?**: `string`

Defined in: [ink/src/types.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/types.ts#L15)
