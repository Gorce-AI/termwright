---
title: "Interface: TermwrightScopeFixture"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightScopeFixture

# Interface: TermwrightScopeFixture

Defined in: [test/src/fixtures.ts:103](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L103)

Test-scoped services that do not depend on a running terminal.

## Properties

### config

> `readonly` **config**: [`ResolvedTermwrightConfig`](../resolvedtermwrightconfig/)

Defined in: [test/src/fixtures.ts:104](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L104)

***

### step

> `readonly` **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:109](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L109)

***

### tmpdir

> `readonly` **tmpdir**: `string`

Defined in: [test/src/fixtures.ts:106](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L106)

Private directory for this test; created on first access, removed after.

***

### traces

> `readonly` **traces**: readonly `string`[]

Defined in: [test/src/fixtures.ts:108](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L108)

Trace archives kept for this test, filled in during teardown.
