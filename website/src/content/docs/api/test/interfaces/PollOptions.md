---
title: "Interface: PollOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / PollOptions

# Interface: PollOptions

Defined in: [test/src/matchers.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L44)

Every matcher accepts a per-assertion timeout override.

## Extended by

- [`CellSnapshotMatcherOptions`](../cellsnapshotmatcheroptions/)
- [`SemanticSnapshotMatcherOptions`](../semanticsnapshotmatcheroptions/)
- [`TextMatcherOptions`](../textmatcheroptions/)

## Properties

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [test/src/matchers.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L46)

Milliseconds to keep re-probing. Defaults to the `expect` timeout class.
