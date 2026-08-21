---
title: "Variable: step"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / step

# Variable: step

> `const` **step**: [`StepRunner`](../../type-aliases/steprunner/)

Defined in: [test/src/fixtures.ts:440](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L440)

Runs `body` as a named step: a marker in the recording, a step event in the
trace, and a labelled section in the HTML report.

This is the free-standing form, used by `test.step()`; it attaches to the
most recently started test. Prefer the `step` fixture, which is bound to its
own test and therefore stays correct under `test.concurrent`.
