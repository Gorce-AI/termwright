---
title: "Interface: TestTimeoutClasses"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TestTimeoutClasses

# Interface: TestTimeoutClasses

Defined in: [test/src/config.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L28)

Timeout classes, extended with the class that governs polling matchers.

## Extends

- `TimeoutClasses`

## Properties

### action?

> `readonly` `optional` **action?**: `number`

Defined in: driver/dist/index.d.ts:10

#### Inherited from

`TimeoutClasses.action`

***

### exit?

> `readonly` `optional` **exit?**: `number`

Defined in: driver/dist/index.d.ts:14

#### Inherited from

`TimeoutClasses.exit`

***

### expect?

> `readonly` `optional` **expect?**: `number`

Defined in: [test/src/config.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L30)

Budget for self-polling matchers (`toBeVisible`, …). Default 5 000 ms.

***

### idle?

> `readonly` `optional` **idle?**: `number`

Defined in: driver/dist/index.d.ts:12

#### Inherited from

`TimeoutClasses.idle`

***

### ready?

> `readonly` `optional` **ready?**: `number`

Defined in: driver/dist/index.d.ts:13

#### Inherited from

`TimeoutClasses.ready`

***

### text?

> `readonly` `optional` **text?**: `number`

Defined in: driver/dist/index.d.ts:11

#### Inherited from

`TimeoutClasses.text`
