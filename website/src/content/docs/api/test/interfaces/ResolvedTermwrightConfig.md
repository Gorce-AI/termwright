---
title: "Interface: ResolvedTermwrightConfig"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ResolvedTermwrightConfig

# Interface: ResolvedTermwrightConfig

Defined in: [test/src/config.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L89)

Configuration with every default filled in.

## Properties

### columns

> `readonly` **columns**: `number`

Defined in: [test/src/config.ts:90](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L90)

***

### command

> `readonly` **command**: readonly `string`[] \| `undefined`

Defined in: [test/src/config.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L96)

***

### env

> `readonly` **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/config.ts:97](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L97)

***

### failOnLogLevel

> `readonly` **failOnLogLevel**: `false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/config.ts:101](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L101)

***

### outputDir

> `readonly` **outputDir**: `string`

Defined in: [test/src/config.ts:94](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L94)

***

### palette

> `readonly` **palette**: [`ColorPalette`](../colorpalette/) \| `undefined`

Defined in: [test/src/config.ts:98](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L98)

***

### profile

> `readonly` **profile**: `string` \| `undefined`

Defined in: [test/src/config.ts:103](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L103)

Name of the profile that was applied, when any.

***

### rows

> `readonly` **rows**: `number`

Defined in: [test/src/config.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L91)

***

### snapshotDir

> `readonly` **snapshotDir**: `string`

Defined in: [test/src/config.ts:95](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L95)

***

### terminalProfile

> `readonly` **terminalProfile**: `string` \| `undefined`

Defined in: [test/src/config.ts:99](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L99)

***

### timeouts

> `readonly` **timeouts**: `Required`\<[`TestTimeoutClasses`](../testtimeoutclasses/)\>

Defined in: [test/src/config.ts:92](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L92)

***

### trace

> `readonly` **trace**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/config.ts:93](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L93)

***

### updateSnapshots

> `readonly` **updateSnapshots**: [`UpdateSnapshotsMode`](../../type-aliases/updatesnapshotsmode/) \| `undefined`

Defined in: [test/src/config.ts:100](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L100)
