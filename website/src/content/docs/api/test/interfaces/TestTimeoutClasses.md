---
title: "Interface: TestTimeoutClasses"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TestTimeoutClasses

# Interface: TestTimeoutClasses

Defined in: [test/src/config.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L34)

Timeout classes, extended with the class that governs polling matchers.

## Extends

- `TimeoutClasses`

## Properties

### action?

> `readonly` `optional` **action?**: `number`

Defined in: driver/dist/session-Br7\_0b2M.d.ts:6

#### Inherited from

`TimeoutClasses.action`

***

### exit?

> `readonly` `optional` **exit?**: `number`

Defined in: driver/dist/session-Br7\_0b2M.d.ts:10

#### Inherited from

`TimeoutClasses.exit`

***

### expect?

> `readonly` `optional` **expect?**: `number`

Defined in: [test/src/config.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L36)

Budget for self-polling matchers (`toBeVisible`, …). Default 5 000 ms.

***

### idle?

> `readonly` `optional` **idle?**: `number`

Defined in: driver/dist/session-Br7\_0b2M.d.ts:8

#### Inherited from

`TimeoutClasses.idle`

***

### ready?

> `readonly` `optional` **ready?**: `number`

Defined in: driver/dist/session-Br7\_0b2M.d.ts:9

#### Inherited from

`TimeoutClasses.ready`

***

### text?

> `readonly` `optional` **text?**: `number`

Defined in: driver/dist/session-Br7\_0b2M.d.ts:7

#### Inherited from

`TimeoutClasses.text`
