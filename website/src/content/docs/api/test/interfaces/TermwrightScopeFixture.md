---
title: "Interface: TermwrightScopeFixture"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightScopeFixture

# Interface: TermwrightScopeFixture

Defined in: [test/src/fixtures.ts:131](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L131)

Test-scoped services that do not depend on a running terminal.

## Properties

### config

> `readonly` **config**: [`ResolvedTermwrightConfig`](../resolvedtermwrightconfig/)

Defined in: [test/src/fixtures.ts:132](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L132)

***

### resources

> `readonly` **resources**: [`ResourceScope`](../resourcescope/)

Defined in: [test/src/fixtures.ts:134](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L134)

Test-owned cleanup, automatically aborted and drained on timeout.

***

### sidecars

> `readonly` **sidecars**: [`SidecarLauncher`](../sidecarlauncher/)

Defined in: [test/src/fixtures.ts:136](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L136)

Background processes owned by this test's timeout-safe resource scope.

***

### step

> `readonly` **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:141](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L141)

***

### tmpdir

> `readonly` **tmpdir**: `string`

Defined in: [test/src/fixtures.ts:138](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L138)

Private directory for this test; created on first access, removed after.

***

### traces

> `readonly` **traces**: readonly `string`[]

Defined in: [test/src/fixtures.ts:140](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L140)

Trace archives kept for this test, filled in during teardown.
