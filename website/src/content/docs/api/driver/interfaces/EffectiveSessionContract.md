---
title: "Interface: EffectiveSessionContract"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EffectiveSessionContract

# Interface: EffectiveSessionContract

Defined in: protocol/dist/contract.d.ts:51

Immutable public contract negotiated once for one session epoch.

Runtime state (disabled nodes, clipping, terminal modes currently off) is
intentionally absent. Those are actionability observations, not capability.

## Properties

### capabilities

> `readonly` **capabilities**: `Readonly`\<`Record`\<[`SessionCapabilityId`](../../type-aliases/sessioncapabilityid/), `SessionCapabilityAvailability`\>\>

Defined in: protocol/dist/contract.d.ts:63

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/contract.d.ts:52

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/contract.d.ts:54

***

### framework

> `readonly` **framework**: \{ `adapterVersion`: `string`; `certificationId`: `string`; `name`: `string`; `version`: `string`; \} \| `null`

Defined in: protocol/dist/contract.d.ts:56

***

### protocol

> `readonly` **protocol**: `"termwright/2"`

Defined in: protocol/dist/contract.d.ts:55

***

### providers

> `readonly` **providers**: readonly `ContractProvider`[]

Defined in: protocol/dist/contract.d.ts:62

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/contract.d.ts:53

***

### terminal

> `readonly` **terminal**: `object`

Defined in: protocol/dist/contract.d.ts:64

#### mouseModesObservable

> `readonly` **mouseModesObservable**: `boolean`

#### platform

> `readonly` **platform**: `string`

#### profile

> `readonly` **profile**: `string`
