---
title: "Function: collectLogs()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / collectLogs

# Function: collectLogs()

> **collectLogs**(`harness`, `into?`): `object`

Defined in: [test/src/logs.ts:181](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L181)

Subscribes to a session's logs.

The fixtures call this for every session they launch. Call it yourself for a
harness they did not create — a `mountInk` component, say — and
`expect(harness).toHaveLogged(…)` starts working on it too.

## Parameters

### harness

[`LogSource`](../../interfaces/logsource/)

### into?

[`LogCollection`](../../interfaces/logcollection/) = `...`

## Returns

`object`

the collection and an unsubscribe function.

### collection

> `readonly` **collection**: [`LogCollection`](../../interfaces/logcollection/)

### dispose()

> **dispose**(): `void`

#### Returns

`void`
