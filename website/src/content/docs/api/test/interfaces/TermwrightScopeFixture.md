---
title: "Interface: TermwrightScopeFixture"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightScopeFixture

# Interface: TermwrightScopeFixture

Defined in: [test/src/fixtures.ts:108](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L108)

Test-scoped services that do not depend on a running terminal.

## Properties

### config

> `readonly` **config**: [`ResolvedTermwrightConfig`](../resolvedtermwrightconfig/)

Defined in: [test/src/fixtures.ts:109](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L109)

***

### step

> `readonly` **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:114](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L114)

***

### tmpdir

> `readonly` **tmpdir**: `string`

Defined in: [test/src/fixtures.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L111)

Private directory for this test; created on first access, removed after.

***

### traces

> `readonly` **traces**: readonly `string`[]

Defined in: [test/src/fixtures.ts:113](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L113)

Trace archives kept for this test, filled in during teardown.
