---
title: "Interface: SemanticQuery"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticQuery

# Interface: SemanticQuery

Defined in: [selectors.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L38)

A descendant chain evaluated against the semantic tree.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [selectors.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L42)

Human-readable form used in diagnostics.

***

### kind

> `readonly` **kind**: `"semantic"`

Defined in: [selectors.ts:39](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L39)

***

### steps

> `readonly` **steps**: readonly [`SemanticStep`](../semanticstep/)[]

Defined in: [selectors.ts:40](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L40)
