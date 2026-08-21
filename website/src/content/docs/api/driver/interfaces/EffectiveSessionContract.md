---
title: "Interface: EffectiveSessionContract"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EffectiveSessionContract

# Interface: EffectiveSessionContract

Defined in: protocol/dist/contract.d.ts:57

Immutable public contract negotiated once for one session epoch.

Runtime state (disabled nodes, clipping, terminal modes currently off) is
intentionally absent. Those are actionability observations, not capability.

## Properties

### capabilities

> `readonly` **capabilities**: `Readonly`\<`Record`\<[`SessionCapabilityId`](../../type-aliases/sessioncapabilityid/), `SessionCapabilityAvailability`\>\>

Defined in: protocol/dist/contract.d.ts:69

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/contract.d.ts:58

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/contract.d.ts:60

***

### framework

> `readonly` **framework**: \{ `adapterVersion`: `string`; `certificationId`: `string`; `name`: `string`; `version`: `string`; \} \| `null`

Defined in: protocol/dist/contract.d.ts:62

***

### protocol

> `readonly` **protocol**: `"termwright/2"`

Defined in: protocol/dist/contract.d.ts:61

***

### providers

> `readonly` **providers**: readonly `ContractProvider`[]

Defined in: protocol/dist/contract.d.ts:68

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/contract.d.ts:59

***

### terminal

> `readonly` **terminal**: `object`

Defined in: protocol/dist/contract.d.ts:70

#### mouseModesObservable

> `readonly` **mouseModesObservable**: `boolean`

#### platform

> `readonly` **platform**: `string`

#### profile

> `readonly` **profile**: `string`
