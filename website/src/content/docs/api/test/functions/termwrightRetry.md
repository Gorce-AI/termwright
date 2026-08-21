---
title: "Function: termwrightRetry()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / termwrightRetry

# Function: termwrightRetry()

> **termwrightRetry**(`options?`): `number`

Defined in: [test/src/config.ts:198](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L198)

Resolves the number for Vitest's native `test.retry` option.

`TERMWRIGHT_RETRIES` wins when present and always means additional attempts,
matching Vitest's own `retry` semantics. Termwright never schedules a second
whole-suite run.

## Parameters

### options?

[`TermwrightRetryOptions`](../../interfaces/termwrightretryoptions/) = `{}`

## Returns

`number`
