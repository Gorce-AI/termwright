---
title: "Interface: TextMatcherOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TextMatcherOptions

# Interface: TextMatcherOptions

Defined in: [test/src/matchers.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L49)

Options for [TermwrightMatchers.toHaveText](../termwrightmatchers/#tohavetext).

## Extends

- [`PollOptions`](../polloptions/)

## Properties

### exact?

> `readonly` `optional` **exact?**: `boolean`

Defined in: [test/src/matchers.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L55)

`true` (default for locators) compares the whole accessible text after
whitespace normalization; `false` asserts a substring. A terminal as the
subject always uses substring matching against the visible grid.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [test/src/matchers.ts:45](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L45)

Milliseconds to keep re-probing. Defaults to the `expect` timeout class.

#### Inherited from

[`PollOptions`](../polloptions/).[`timeout`](../polloptions/#timeout)
