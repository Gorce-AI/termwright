---
title: "Interface: TermwrightRetryOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightRetryOptions

# Interface: TermwrightRetryOptions

Defined in: [test/src/config.ts:182](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L182)

## Properties

### ci?

> `readonly` `optional` **ci?**: `number`

Defined in: [test/src/config.ts:184](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L184)

Additional attempts on CI. Default 0; diagnostics must opt in explicitly.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

Defined in: [test/src/config.ts:188](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L188)

Environment used for CI detection and `TERMWRIGHT_RETRIES`.

***

### local?

> `readonly` `optional` **local?**: `number`

Defined in: [test/src/config.ts:186](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L186)

Additional attempts outside CI. Default 0.
