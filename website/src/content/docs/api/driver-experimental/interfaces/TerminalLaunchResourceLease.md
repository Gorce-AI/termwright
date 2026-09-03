---
title: "Interface: TerminalLaunchResourceLease"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / TerminalLaunchResourceLease

# Interface: TerminalLaunchResourceLease

Defined in: [launch-resources.ts:3](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/launch-resources.ts#L3)

Host-owned resource admission at the actual terminal allocation boundary.

## Methods

### attach()

> **attach**(`sessionId`): `Promise`\<`void`\>

Defined in: [launch-resources.ts:5](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/launch-resources.ts#L5)

Binds admitted capacity to the concrete session before allocation.

#### Parameters

##### sessionId

`string`

#### Returns

`Promise`\<`void`\>

***

### release()

> **release**(): `Promise`\<`void`\>

Defined in: [launch-resources.ts:7](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/launch-resources.ts#L7)

Releases capacity only after the driver's verified teardown barrier.

#### Returns

`Promise`\<`void`\>
