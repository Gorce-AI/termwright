---
title: "Interface: EffectiveSessionContract"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EffectiveSessionContract

# Interface: EffectiveSessionContract

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:724

Immutable public contract negotiated once for one session epoch.

Runtime state (disabled nodes, clipping, terminal modes currently off) is
intentionally absent. Those are actionability observations, not capability.

## Properties

### capabilities

> `readonly` **capabilities**: `Readonly`\<`Record`\<[`SessionCapabilityId`](../../type-aliases/sessioncapabilityid/), `SessionCapabilityAvailability`\>\>

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:738

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:725

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:727

***

### framework

> `readonly` **framework**: \{ `adapterVersion`: `string`; `certificationId`: `string`; `instrumentation?`: `ProbeInstrumentation`; `name`: `string`; `version`: `string`; \} \| `null`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:729

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

> `readonly` **protocol**: `"termwright/2"`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:728

***

### providers

> `readonly` **providers**: readonly `ContractProvider`[]

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:737

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:726

***

### terminal

> `readonly` **terminal**: `object`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:739

#### mouseModesObservable

> `readonly` **mouseModesObservable**: `boolean`

#### platform

> `readonly` **platform**: `string`

#### profile

> `readonly` **profile**: `string`
