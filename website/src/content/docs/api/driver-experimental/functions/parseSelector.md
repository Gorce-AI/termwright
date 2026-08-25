---
title: "Function: parseSelector()"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / parseSelector

# Function: parseSelector()

> **parseSelector**(`selector`): [`SemanticQuery`](../../interfaces/semanticquery/)

Defined in: [selectors.ts:215](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L215)

Parses the Termwright Semantic Selector Language into a [SemanticQuery](../../interfaces/semanticquery/).

## Parameters

### selector

`string`

## Returns

[`SemanticQuery`](../../interfaces/semanticquery/)

## Example

```ts
parseSelector('dialog button.primary:focused');
parseSelector('#confirm-button');
```
