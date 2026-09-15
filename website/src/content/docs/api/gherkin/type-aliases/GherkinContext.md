---
title: "Type Alias: GherkinContext"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / GherkinContext

# Type Alias: GherkinContext\<Fixtures\>

> **GherkinContext**\<`Fixtures`\> = `TermwrightFixtures` & `Fixtures` & `object`

Defined in: [definitions.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L21)

Termwright's native and project fixtures plus Gherkin's per-scenario state.

## Type Declaration

### defer

> `readonly` **defer**: (`cleanup`) => `void`

Registers test-scoped cleanup. Cleanups run in reverse order after `After` hooks.

#### Parameters

##### cleanup

() => `unknown` \| `Promise`\<`unknown`\>

#### Returns

`void`

### expect

> `readonly` **expect**: `TermwrightExpect`

### resources

> `readonly` **resources**: `ResourceScope`

Scenario-owned resources. A child of the enclosing test scope.

### scenario

> `readonly` **scenario**: [`GherkinScenario`](../../interfaces/gherkinscenario/)

### signal

> `readonly` **signal**: `AbortSignal`

Scenario cancellation, aborted by the native test timeout.

### use

> `readonly` **use**: \<`T`\>(`resource`) => `T`

Registers a closeable/disposable resource and returns it unchanged.

#### Type Parameters

##### T

`T` *extends* [`GherkinResource`](../gherkinresource/)

#### Parameters

##### resource

`T`

#### Returns

`T`

### world

> `readonly` **world**: [`GherkinWorld`](../gherkinworld/)

## Type Parameters

### Fixtures

`Fixtures` *extends* `object` = `object`
