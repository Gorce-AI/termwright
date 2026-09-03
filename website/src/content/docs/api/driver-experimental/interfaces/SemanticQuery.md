---
title: "Interface: SemanticQuery"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / SemanticQuery

# Interface: SemanticQuery

Defined in: [selectors.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L36)

A descendant chain evaluated against the semantic tree.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [selectors.ts:40](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L40)

Human-readable form used in diagnostics.

***

### kind

> `readonly` **kind**: `"semantic"`

Defined in: [selectors.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L37)

***

### steps

> `readonly` **steps**: readonly [`SemanticStep`](../semanticstep/)[]

Defined in: [selectors.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L38)
