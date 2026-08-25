---
title: "Interface: SemanticSnapshotMatcherOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SemanticSnapshotMatcherOptions

# Interface: SemanticSnapshotMatcherOptions

Defined in: [test/src/matchers.ts:66](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L66)

Options for [TermwrightMatchers.toMatchSemanticSnapshot](../termwrightmatchers/#tomatchsemanticsnapshot).

## Extends

- [`PollOptions`](../polloptions/)

## Properties

### rootId?

> `readonly` `optional` **rootId?**: `string`

Defined in: [test/src/matchers.ts:78](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L78)

Snapshot this node's subtree, the node included. Mutually exclusive with `within`.

***

### states?

> `readonly` `optional` **states?**: [`StateSelection`](../../type-aliases/stateselection/)

Defined in: [test/src/matchers.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L80)

Which state flags a written snapshot records. Default `stable`.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [test/src/matchers.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L49)

Milliseconds to keep re-probing. Defaults to the `expect` timeout class.

#### Inherited from

[`PollOptions`](../polloptions/).[`timeout`](../polloptions/#timeout)

***

### within?

> `readonly` `optional` **within?**: [`AnyLocator`](../../type-aliases/anylocator/)

Defined in: [test/src/matchers.ts:76](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L76)

Match the pattern against what is *inside* this locator.

The node itself is not part of the pattern, so a test can assert a dialog's
contents without restating the application and region nodes above it — the
usual shape for Ink and Textual apps, whose tree is rooted at
`application`. Re-resolved on every attempt, so a re-render that mints new
node ids does not invalidate the scope.
