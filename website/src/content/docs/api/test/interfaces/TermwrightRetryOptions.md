---
title: "Interface: TermwrightRetryOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightRetryOptions

# Interface: TermwrightRetryOptions

Defined in: [test/src/config.ts:214](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L214)

## Properties

### ci?

> `readonly` `optional` **ci?**: `number`

Defined in: [test/src/config.ts:216](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L216)

Additional attempts on CI. Default 0; diagnostics must opt in explicitly.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

Defined in: [test/src/config.ts:220](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L220)

Environment used for CI detection and `TERMWRIGHT_RETRIES`.

***

### local?

> `readonly` `optional` **local?**: `number`

Defined in: [test/src/config.ts:218](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L218)

Additional attempts outside CI. Default 0.
