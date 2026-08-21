---
title: "Interface: GherkinContext"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / GherkinContext

# Interface: GherkinContext

Defined in: [gherkin/src/definitions.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L16)

Termwright's native fixtures plus Gherkin's per-scenario world and metadata.

## Extends

- `TermwrightFixtures`

## Properties

### defer

> `readonly` **defer**: (`cleanup`) => `void`

Defined in: [gherkin/src/definitions.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L21)

Registers test-scoped cleanup. Cleanups run in reverse order after `After` hooks.

#### Parameters

##### cleanup

() => `unknown`

#### Returns

`void`

***

### expect

> `readonly` **expect**: `ExpectStatic`

Defined in: [gherkin/src/definitions.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L17)

***

### scenario

> `readonly` **scenario**: [`GherkinScenario`](../gherkinscenario/)

Defined in: [gherkin/src/definitions.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L19)

***

### step

> **step**: `StepRunner`

Defined in: test/dist/index.d.ts:255

#### Inherited from

`TermwrightFixtures.step`

***

### terminal

> **terminal**: `TerminalFactory`

Defined in: test/dist/index.d.ts:254

#### Inherited from

`TermwrightFixtures.terminal`

***

### termwright

> **termwright**: `TermwrightScopeFixture`

Defined in: test/dist/index.d.ts:253

#### Inherited from

`TermwrightFixtures.termwright`

***

### termwrightOptions

> **termwrightOptions**: `TermwrightOptions`

Defined in: test/dist/index.d.ts:252

Options for this file or suite, the equivalent of Playwright's `test.use()`:

```ts
test.scoped({ termwrightOptions: { columns: 120, trace: 'on' } });
```

They sit between the project configuration and a `launch()` call, merged
key by key — scoping one option keeps the rest.

#### Inherited from

`TermwrightFixtures.termwrightOptions`

***

### use

> `readonly` **use**: \<`T`\>(`resource`) => `T`

Defined in: [gherkin/src/definitions.ts:23](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L23)

Registers a closeable/disposable resource and returns it unchanged.

#### Type Parameters

##### T

`T` *extends* [`GherkinResource`](../gherkinresource/)

#### Parameters

##### resource

`T`

#### Returns

`T`

***

### world

> `readonly` **world**: [`GherkinWorld`](../../type-aliases/gherkinworld/)

Defined in: [gherkin/src/definitions.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L18)
