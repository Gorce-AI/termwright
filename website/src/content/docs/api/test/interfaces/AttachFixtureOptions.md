---
title: "Interface: AttachFixtureOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / AttachFixtureOptions

# Interface: AttachFixtureOptions

Defined in: [test/src/fixtures.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L73)

Options for adopting a harness created by a framework component helper.

## Properties

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/fixtures.ts:77](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L77)

Command label stored in the trace metadata.

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/fixtures.ts:75](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L75)

Trace policy for this session, overriding the file's and project's.
