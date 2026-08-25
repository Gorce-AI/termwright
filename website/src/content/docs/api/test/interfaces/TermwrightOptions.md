---
title: "Interface: TermwrightOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightOptions

# Interface: TermwrightOptions

Defined in: [test/src/options.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L16)

Options a file or suite may override with `test.override`.

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

Defined in: [test/src/options.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L28)

Merged key by key over the project's `env` — overriding one variable keeps
the rest, which is the only behaviour that makes suite overrides usable.

***

### failOnLogLevel?

> `readonly` `optional` **failOnLogLevel?**: `false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/options.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L34)

Initial threshold for this test; `terminal.failOnLogLevel()` still wins.

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"focus"` \| `"pointer-input"` \| `"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: [test/src/options.ts:23](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L23)

Replaces the project capability requirements for this scope.

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

Defined in: [test/src/options.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L30)

Merged key by key over the project's timeout classes.

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/options.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/options.ts#L32)

Trace policy for the sessions this file or suite launches.
