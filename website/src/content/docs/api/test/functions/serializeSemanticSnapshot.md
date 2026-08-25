---
title: "Function: serializeSemanticSnapshot()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / serializeSemanticSnapshot

# Function: serializeSemanticSnapshot()

> **serializeSemanticSnapshot**(`snapshot`, `options?`): `string`

Defined in: [test/src/yaml-serialize.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L80)

Renders the snapshot as YAML.

## Parameters

### snapshot

`SemanticSnapshot`

### options?

[`SerializeOptions`](../../interfaces/serializeoptions/) = `{}`

## Returns

`string`

the tree, one node per line, newline-terminated; `''` for a tree
with no visible nodes.

## Example

```ts
const yaml = serializeSemanticSnapshot(terminal.semanticTree()!);
// - dialog "Permission" [modal]:
//     - button "Approve" [focused]
```
