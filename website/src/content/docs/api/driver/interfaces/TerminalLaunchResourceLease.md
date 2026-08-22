---
title: "Interface: TerminalLaunchResourceLease"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalLaunchResourceLease

# Interface: TerminalLaunchResourceLease

Defined in: driver/src/launch-resources.ts:3

Host-owned resource admission at the actual terminal allocation boundary.

## Methods

### attach()

> **attach**(`sessionId`): `Promise`\<`void`\>

Defined in: driver/src/launch-resources.ts:5

Binds admitted capacity to the concrete session before allocation.

#### Parameters

##### sessionId

`string`

#### Returns

`Promise`\<`void`\>

***

### release()

> **release**(): `Promise`\<`void`\>

Defined in: driver/src/launch-resources.ts:7

Releases capacity only after the driver's verified teardown barrier.

#### Returns

`Promise`\<`void`\>
