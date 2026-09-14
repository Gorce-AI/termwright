---
title: "Interface: TermwrightFixtures"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightFixtures

# Interface: TermwrightFixtures

Defined in: [test/src/fixtures.ts:178](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L178)

Fixtures added to Vitest's `test`.

## Properties

### step

> **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:192](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L192)

***

### terminal

> **terminal**: [`TerminalFactory`](../terminalfactory/)

Defined in: [test/src/fixtures.ts:191](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L191)

***

### termwright

> **termwright**: [`TermwrightScopeFixture`](../termwrightscopefixture/)

Defined in: [test/src/fixtures.ts:190](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L190)

***

### termwrightOptions

> **termwrightOptions**: [`TermwrightOptions`](../termwrightoptions/)

Defined in: [test/src/fixtures.ts:189](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L189)

Options for this file or suite, the equivalent of Playwright's `test.use()`:

```ts
test.override({ termwrightOptions: { columns: 120, trace: 'on' } });
```

They sit between the project configuration and a `launch()` call, merged
key by key — scoping one option keeps the rest.
