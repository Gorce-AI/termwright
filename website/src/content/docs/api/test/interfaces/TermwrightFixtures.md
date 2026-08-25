---
title: "Interface: TermwrightFixtures"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightFixtures

# Interface: TermwrightFixtures

Defined in: [test/src/fixtures.ts:146](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L146)

Fixtures added to Vitest's `test`.

## Properties

### step

> **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L160)

***

### terminal

> **terminal**: [`TerminalFactory`](../terminalfactory/)

Defined in: [test/src/fixtures.ts:159](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L159)

***

### termwright

> **termwright**: [`TermwrightScopeFixture`](../termwrightscopefixture/)

Defined in: [test/src/fixtures.ts:158](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L158)

***

### termwrightOptions

> **termwrightOptions**: [`TermwrightOptions`](../termwrightoptions/)

Defined in: [test/src/fixtures.ts:157](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L157)

Options for this file or suite, the equivalent of Playwright's `test.use()`:

```ts
test.override({ termwrightOptions: { columns: 120, trace: 'on' } });
```

They sit between the project configuration and a `launch()` call, merged
key by key — scoping one option keeps the rest.
