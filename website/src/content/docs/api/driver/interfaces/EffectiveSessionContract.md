---
title: "Interface: EffectiveSessionContract"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EffectiveSessionContract

# Interface: EffectiveSessionContract

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:759

Immutable public contract negotiated once for one session epoch.

Runtime state (disabled nodes, clipping, terminal modes currently off) is
intentionally absent. Those are actionability observations, not capability.

## Properties

### capabilities

> `readonly` **capabilities**: `Readonly`\<`Record`\<[`SessionCapabilityId`](../../type-aliases/sessioncapabilityid/), `SessionCapabilityAvailability`\>\>

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:773

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:760

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:762

***

### framework

> `readonly` **framework**: \{ `adapterVersion`: `string`; `certificationId`: `string`; `instrumentation?`: `ProbeInstrumentation`; `name`: `string`; `version`: `string`; \} \| `null`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:764

#### Union Members

##### Type Literal

\{ `adapterVersion`: `string`; `certificationId`: `string`; `instrumentation?`: `ProbeInstrumentation`; `name`: `string`; `version`: `string`; \}

##### adapterVersion

> `readonly` **adapterVersion**: `string`

##### certificationId

> `readonly` **certificationId**: `string`

##### instrumentation?

> `readonly` `optional` **instrumentation?**: `ProbeInstrumentation`

Runtime attachment facts declared by a framework probe, when available.

##### name

> `readonly` **name**: `string`

##### version

> `readonly` **version**: `string`

***

`null`

***

### protocol

> `readonly` **protocol**: `"termwright/3"`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:763

***

### providers

> `readonly` **providers**: readonly `ContractProvider`[]

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:772

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:761

***

### terminal

> `readonly` **terminal**: `object`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:774

#### mouseModesObservable

> `readonly` **mouseModesObservable**: `boolean`

#### platform

> `readonly` **platform**: `string`

#### profile

> `readonly` **profile**: `string`
