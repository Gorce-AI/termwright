---
title: "Class: TermwrightError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TermwrightError

# Class: TermwrightError

Defined in: [driver/src/errors.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L19)

Base class for every error the driver throws. Carries a stable [code](#code)
plus Playwright-grade [diagnostics](#diagnostics) (what was observed, which
candidates existed, and a suggestion).

## Extends

- `Error`

## Extended by

- [`AmbiguousLocatorError`](../ambiguouslocatorerror/)
- [`AdapterGuaranteeViolationError`](../adapterguaranteeviolationerror/)
- [`DuplicateSemanticKeyError`](../duplicatesemantickeyerror/)
- [`CapabilityProviderLostError`](../capabilityproviderlosterror/)
- [`CapabilityProviderViolationError`](../capabilityproviderviolationerror/)
- [`EvidenceConflictError`](../evidenceconflicterror/)
- [`CapabilityUnavailableError`](../capabilityunavailableerror/)
- [`CapacityError`](../capacityerror/)
- [`HistoryTruncatedError`](../historytruncatederror/)
- [`InputModeDisabledError`](../inputmodedisablederror/)
- [`NotFoundError`](../notfounderror/)
- [`NotActionableError`](../notactionableerror/)
- [`ProbeAttachFailedError`](../probeattachfailederror/)
- [`ProcessExitedError`](../processexitederror/)
- [`PtyBackendError`](../ptybackenderror/)
- [`ProtocolViolationError`](../protocolviolationerror/)
- [`SessionClosedError`](../sessionclosederror/)
- [`SemanticCapabilityUnavailableError`](../semanticcapabilityunavailableerror/)
- [`StaleSnapshotError`](../stalesnapshoterror/)
- [`TimeoutError`](../timeouterror/)

## Constructors

### Constructor

> **new TermwrightError**(`code`, `message`, `diagnostics`): `TermwrightError`

Defined in: [driver/src/errors.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L24)

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

### actionability?

> `optional` **actionability?**: [`ActionabilityExplanation`](../../interfaces/actionabilityexplanation/)

Defined in: [driver/src/errors.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L22)

***

### code

> `readonly` **code**: [`TermwrightErrorCode`](../../type-aliases/termwrighterrorcode/)

Defined in: [driver/src/errors.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L20)

***

### diagnostics

> `readonly` **diagnostics**: [`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

Defined in: [driver/src/errors.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L21)

## Methods

### toString()

> **toString**(): `string`

Defined in: [driver/src/errors.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L38)

Renders message + diagnostics the way test runners print failures.

#### Returns

`string`

***

### withActionability()

> **withActionability**(`explanation`): `this`

Defined in: [driver/src/errors.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L32)

Attach the exact failed planner evaluation; never recomputed after state changes.

#### Parameters

##### explanation

[`ActionabilityExplanation`](../../interfaces/actionabilityexplanation/)

#### Returns

`this`
