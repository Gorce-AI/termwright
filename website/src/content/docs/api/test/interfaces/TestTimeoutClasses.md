---
title: "Interface: TestTimeoutClasses"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TestTimeoutClasses

# Interface: TestTimeoutClasses

Defined in: [test/src/config.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L33)

Timeout classes, extended with the class that governs polling matchers.

## Extends

- `TimeoutClasses`

## Properties

### action?

> `readonly` `optional` **action?**: `number`

Defined in: driver/dist/session-Bj2f3PDs.d.ts:5

#### Inherited from

`TimeoutClasses.action`

***

### exit?

> `readonly` `optional` **exit?**: `number`

Defined in: driver/dist/session-Bj2f3PDs.d.ts:9

#### Inherited from

`TimeoutClasses.exit`

***

### expect?

> `readonly` `optional` **expect?**: `number`

Defined in: [test/src/config.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L35)

Budget for self-polling matchers (`toBeVisible`, …). Default 5 000 ms.

***

### idle?

> `readonly` `optional` **idle?**: `number`

Defined in: driver/dist/session-Bj2f3PDs.d.ts:7

#### Inherited from

`TimeoutClasses.idle`

***

### ready?

> `readonly` `optional` **ready?**: `number`

Defined in: driver/dist/session-Bj2f3PDs.d.ts:8

#### Inherited from

`TimeoutClasses.ready`

***

### text?

> `readonly` `optional` **text?**: `number`

Defined in: driver/dist/session-Bj2f3PDs.d.ts:6

#### Inherited from

`TimeoutClasses.text`
