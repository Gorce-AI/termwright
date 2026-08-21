---
title: "Interface: ResolvedTermwrightConfig"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ResolvedTermwrightConfig

# Interface: ResolvedTermwrightConfig

Defined in: [test/src/config.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L96)

Configuration with every default filled in.

## Properties

### columns

> `readonly` **columns**: `number`

Defined in: [test/src/config.ts:97](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L97)

***

### command

> `readonly` **command**: readonly `string`[] \| `undefined`

Defined in: [test/src/config.ts:103](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L103)

***

### env

> `readonly` **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/config.ts:105](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L105)

***

### failOnLogLevel

> `readonly` **failOnLogLevel**: `false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/config.ts:109](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L109)

***

### outputDir

> `readonly` **outputDir**: `string`

Defined in: [test/src/config.ts:101](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L101)

***

### palette

> `readonly` **palette**: [`ColorPalette`](../colorpalette/) \| `undefined`

Defined in: [test/src/config.ts:106](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L106)

***

### profile

> `readonly` **profile**: `string` \| `undefined`

Defined in: [test/src/config.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L111)

Name of the profile that was applied, when any.

***

### requiredCapabilities

> `readonly` **requiredCapabilities**: readonly (`"focus"` \| `"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"scroll"` \| `"render-order"` \| `"keyboard-input"` \| `"pointer-input"` \| `"paired-revisions"`)[]

Defined in: [test/src/config.ts:104](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L104)

***

### rows

> `readonly` **rows**: `number`

Defined in: [test/src/config.ts:98](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L98)

***

### snapshotDir

> `readonly` **snapshotDir**: `string`

Defined in: [test/src/config.ts:102](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L102)

***

### terminalProfile

> `readonly` **terminalProfile**: `string` \| `undefined`

Defined in: [test/src/config.ts:107](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L107)

***

### timeouts

> `readonly` **timeouts**: `Required`\<[`TestTimeoutClasses`](../testtimeoutclasses/)\>

Defined in: [test/src/config.ts:99](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L99)

***

### trace

> `readonly` **trace**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/config.ts:100](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L100)

***

### updateSnapshots

> `readonly` **updateSnapshots**: [`UpdateSnapshotsMode`](../../type-aliases/updatesnapshotsmode/) \| `undefined`

Defined in: [test/src/config.ts:108](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L108)
