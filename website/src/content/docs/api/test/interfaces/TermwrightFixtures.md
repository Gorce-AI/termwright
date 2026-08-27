---
title: "Interface: TermwrightFixtures"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightFixtures

# Interface: TermwrightFixtures

Defined in: [test/src/fixtures.ts:162](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L162)

Fixtures added to Vitest's `test`.

## Properties

### step

> **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:176](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L176)

***

### terminal

> **terminal**: [`TerminalFactory`](../terminalfactory/)

Defined in: [test/src/fixtures.ts:175](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L175)

***

### termwright

> **termwright**: [`TermwrightScopeFixture`](../termwrightscopefixture/)

Defined in: [test/src/fixtures.ts:174](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L174)

***

### termwrightOptions

> **termwrightOptions**: [`TermwrightOptions`](../termwrightoptions/)

Defined in: [test/src/fixtures.ts:173](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L173)

Options for this file or suite, the equivalent of Playwright's `test.use()`:

```ts
test.override({ termwrightOptions: { columns: 120, trace: 'on' } });
```

They sit between the project configuration and a `launch()` call, merged
key by key — scoping one option keeps the rest.
