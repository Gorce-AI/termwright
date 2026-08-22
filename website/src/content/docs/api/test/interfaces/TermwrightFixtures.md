---
title: "Interface: TermwrightFixtures"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightFixtures

# Interface: TermwrightFixtures

Defined in: [test/src/fixtures.ts:141](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L141)

Fixtures added to Vitest's `test`.

## Properties

### step

> **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:155](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L155)

***

### terminal

> **terminal**: [`TerminalFactory`](../terminalfactory/)

Defined in: [test/src/fixtures.ts:154](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L154)

***

### termwright

> **termwright**: [`TermwrightScopeFixture`](../termwrightscopefixture/)

Defined in: [test/src/fixtures.ts:153](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L153)

***

### termwrightOptions

> **termwrightOptions**: [`TermwrightOptions`](../termwrightoptions/)

Defined in: [test/src/fixtures.ts:152](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L152)

Options for this file or suite, the equivalent of Playwright's `test.use()`:

```ts
test.scoped({ termwrightOptions: { columns: 120, trace: 'on' } });
```

They sit between the project configuration and a `launch()` call, merged
key by key — scoping one option keeps the rest.
