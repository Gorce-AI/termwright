---
title: "Interface: SemanticQuery"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticQuery

# Interface: SemanticQuery

Defined in: [driver/src/selectors.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L36)

A descendant chain evaluated against the semantic tree.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [driver/src/selectors.ts:40](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L40)

Human-readable form used in diagnostics.

***

### kind

> `readonly` **kind**: `"semantic"`

Defined in: [driver/src/selectors.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L37)

***

### steps

> `readonly` **steps**: readonly [`SemanticStep`](../semanticstep/)[]

Defined in: [driver/src/selectors.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L38)
