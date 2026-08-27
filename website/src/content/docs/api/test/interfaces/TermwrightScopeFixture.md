---
title: "Interface: TermwrightScopeFixture"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightScopeFixture

# Interface: TermwrightScopeFixture

Defined in: [test/src/fixtures.ts:124](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L124)

Test-scoped services that do not depend on a running terminal.

## Properties

### config

> `readonly` **config**: [`ResolvedTermwrightConfig`](../resolvedtermwrightconfig/)

Defined in: [test/src/fixtures.ts:125](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L125)

***

### step

> `readonly` **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L130)

***

### tmpdir

> `readonly` **tmpdir**: `string`

Defined in: [test/src/fixtures.ts:127](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L127)

Private directory for this test; created on first access, removed after.

***

### traces

> `readonly` **traces**: readonly `string`[]

Defined in: [test/src/fixtures.ts:129](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L129)

Trace archives kept for this test, filled in during teardown.
