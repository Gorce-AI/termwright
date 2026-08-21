---
title: "Interface: SerializeOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SerializeOptions

# Interface: SerializeOptions

Defined in: [test/src/yaml-serialize.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L21)

Options for [serializeSemanticSnapshot](../../functions/serializesemanticsnapshot/).

## Properties

### includeRoot?

> `readonly` `optional` **includeRoot?**: `boolean`

Defined in: [test/src/yaml-serialize.ts:39](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L39)

With `rootId`, whether that node is itself the top level (default) or only
the parent of it — `false` serializes what is *inside* the node, which is
what scoping to a container is normally for.

***

### indent?

> `readonly` `optional` **indent?**: `number`

Defined in: [test/src/yaml-serialize.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L31)

Indentation per level, in spaces. Default 4, matching the contract.

***

### rootId?

> `readonly` `optional` **rootId?**: `string`

Defined in: [test/src/yaml-serialize.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L33)

Serialize this node and its descendants instead of the whole tree.

***

### skipHidden?

> `readonly` `optional` **skipHidden?**: `boolean`

Defined in: [test/src/yaml-serialize.ts:41](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L41)

Drop nodes carrying `state.hidden`. Default false.

***

### states?

> `readonly` `optional` **states?**: [`StateSelection`](../../type-aliases/stateselection/)

Defined in: [test/src/yaml-serialize.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/yaml-serialize.ts#L29)

State keys to emit.

`stable` (default) skips positional and scroll states, which change on
every repaint and would make snapshots churn; `all` emits every key set by
the adapter; an explicit list pins exactly what the test cares about.
