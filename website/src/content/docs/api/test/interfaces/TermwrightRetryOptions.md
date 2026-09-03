---
title: "Interface: TermwrightRetryOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightRetryOptions

# Interface: TermwrightRetryOptions

Defined in: [test/src/config.ts:215](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L215)

## Properties

### ci?

> `readonly` `optional` **ci?**: `number`

Defined in: [test/src/config.ts:217](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L217)

Additional attempts on CI. Default 0; diagnostics must opt in explicitly.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

Defined in: [test/src/config.ts:221](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L221)

Environment used for CI detection and `TERMWRIGHT_RETRIES`.

***

### local?

> `readonly` `optional` **local?**: `number`

Defined in: [test/src/config.ts:219](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L219)

Additional attempts outside CI. Default 0.
