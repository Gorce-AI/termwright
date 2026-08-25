---
title: "Function: Semantic()"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / Semantic

# Function: Semantic()

> **Semantic**(`__namedParameters`): `ReactNode`

Defined in: [ink/src/semantic.tsx:58](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/semantic.tsx#L58)

Annotate the element a child renders, declaratively.

Nested `<Semantic>` elements need no wiring: the probe derives `parentId`
from the rendered tree, so a `listitem` inside a `list` is published under
it because that is where it actually sits.

It works with ordinary `ink.render`; the optional injected probe reads the
weak registry. The component adds no host node and therefore no layout box.

## Parameters

### \_\_namedParameters

[`SemanticProps`](../../interfaces/semanticprops/)

## Returns

`ReactNode`

## Example

```tsx
<Semantic role="dialog" name="Permission" extended={{environment: "prod"}}>
  <Box borderStyle="round" flexDirection="column">
    <Semantic role="button" name="Approve">
      <Box><Text>Approve</Text></Box>
    </Semantic>
  </Box>
</Semantic>
```
