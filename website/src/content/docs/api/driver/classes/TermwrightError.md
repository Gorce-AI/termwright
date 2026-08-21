---
title: "Class: TermwrightError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TermwrightError

# Class: TermwrightError

Defined in: [errors.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L18)

Base class for every error the driver throws. Carries a stable [code](#code)
plus Playwright-grade [diagnostics](#diagnostics) (what was observed, which
candidates existed, and a suggestion).

## Extends

- `Error`

## Extended by

- [`AmbiguousLocatorError`](../ambiguouslocatorerror/)
- [`CapacityError`](../capacityerror/)
- [`HistoryTruncatedError`](../historytruncatederror/)
- [`NotFoundError`](../notfounderror/)
- [`ProcessExitedError`](../processexitederror/)
- [`ProtocolViolationError`](../protocolviolationerror/)
- [`SessionClosedError`](../sessionclosederror/)
- [`StaleSnapshotError`](../stalesnapshoterror/)
- [`TimeoutError`](../timeouterror/)
- [`UnsupportedActionError`](../unsupportedactionerror/)

## Constructors

### Constructor

> **new TermwrightError**(`code`, `message`, `diagnostics`): `TermwrightError`

Defined in: [errors.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L22)

#### Parameters

##### code

[`TermwrightErrorCode`](../../type-aliases/termwrighterrorcode/)

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`TermwrightError`

#### Overrides

`Error.constructor`

## Properties

### code

> `readonly` **code**: [`TermwrightErrorCode`](../../type-aliases/termwrighterrorcode/)

Defined in: [errors.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L19)

***

### diagnostics

> `readonly` **diagnostics**: [`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

Defined in: [errors.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L20)

## Methods

### toString()

> **toString**(): `string`

Defined in: [errors.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L30)

Renders message + diagnostics the way test runners print failures.

#### Returns

`string`
