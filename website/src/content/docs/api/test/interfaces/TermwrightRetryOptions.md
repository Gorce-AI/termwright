---
title: "Interface: TermwrightRetryOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightRetryOptions

# Interface: TermwrightRetryOptions

Defined in: [test/src/config.ts:174](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L174)

## Properties

### ci?

> `readonly` `optional` **ci?**: `number`

Defined in: [test/src/config.ts:176](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L176)

Additional attempts on CI. Default 2.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

Defined in: [test/src/config.ts:180](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L180)

Environment used for CI detection and `TERMWRIGHT_RETRIES`.

***

### local?

> `readonly` `optional` **local?**: `number`

Defined in: [test/src/config.ts:178](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L178)

Additional attempts outside CI. Default 0.
