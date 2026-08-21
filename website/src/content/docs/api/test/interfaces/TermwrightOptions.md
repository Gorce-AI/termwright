---
title: "Interface: TermwrightOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightOptions

# Interface: TermwrightOptions

Defined in: [test/src/options.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L16)

Options a file or suite may override with `test.scoped`.

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [test/src/options.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L19)

***

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/options.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L18)

Replaced wholly, never concatenated: an argv is not a merge.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/options.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L26)

Merged key by key over the project's `env` — scoping one variable keeps
the rest, which is the only behaviour that makes scoping usable here.

***

### failOnLogLevel?

> `readonly` `optional` **failOnLogLevel?**: `false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/options.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L32)

Initial threshold for this test; `terminal.failOnLogLevel()` still wins.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [test/src/options.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L20)

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [test/src/options.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L21)

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TestTimeoutClasses`](../testtimeoutclasses/)

Defined in: [test/src/options.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L28)

Merged key by key over the project's timeout classes.

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/options.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L30)

Trace policy for the sessions this file or suite launches.
