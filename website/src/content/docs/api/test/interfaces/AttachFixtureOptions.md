---
title: "Interface: AttachFixtureOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / AttachFixtureOptions

# Interface: AttachFixtureOptions

Defined in: [test/src/fixtures.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L87)

Options for adopting a harness created by a framework component helper.

## Properties

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/fixtures.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L91)

Command label stored in the trace metadata.

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/fixtures.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L89)

Trace policy for this session, overriding the file's and project's.
