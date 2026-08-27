---
title: "Function: composeTagExpressions()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / composeTagExpressions

# Function: composeTagExpressions()

> **composeTagExpressions**(`configured`, `requested`): `string` \| `undefined`

Defined in: [plugin.ts:436](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L436)

Combines the project's tag filter with the one a command line asked for.

Both are Cucumber tag expressions and both are restrictions, so the answer
is their conjunction — a config selecting `@component` and a run asking for
`not @slow` means both, not whichever was read last. Each side is
parenthesised because tag expressions contain `or`, and `a or b and c` is
not what either author wrote.

## Parameters

### configured

`string` \| `undefined`

### requested

`string` \| `undefined`

## Returns

`string` \| `undefined`
