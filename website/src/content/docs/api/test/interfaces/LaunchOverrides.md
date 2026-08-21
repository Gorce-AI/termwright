---
title: "Interface: LaunchOverrides"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / LaunchOverrides

# Interface: LaunchOverrides

Defined in: [test/src/options.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L38)

What a single `launch()` call may override on top of everything else.

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [test/src/options.ts:40](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L40)

***

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/options.ts:39](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L39)

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/options.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L44)

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"focus"` \| `"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"scroll"` \| `"render-order"` \| `"keyboard-input"` \| `"pointer-input"` \| `"paired-revisions"`)[]

Defined in: [test/src/options.ts:43](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L43)

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [test/src/options.ts:41](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L41)

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [test/src/options.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L42)

***

### timeouts?

> `readonly` `optional` **timeouts?**: `TimeoutClasses`

Defined in: [test/src/options.ts:45](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L45)

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/options.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L46)
