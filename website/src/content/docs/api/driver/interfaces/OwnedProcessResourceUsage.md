---
title: "Interface: OwnedProcessResourceUsage"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / OwnedProcessResourceUsage

# Interface: OwnedProcessResourceUsage

Defined in: [driver/src/api.ts:155](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L155)

Whole-tree accounting with the native source and units kept explicit.

## Properties

### activeProcesses

> `readonly` **activeProcesses**: `number`

Defined in: [driver/src/api.ts:168](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L168)

***

### kernelTime100ns

> `readonly` **kernelTime100ns**: `number`

Defined in: [driver/src/api.ts:158](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L158)

***

### otherOperationCount

> `readonly` **otherOperationCount**: `number`

Defined in: [driver/src/api.ts:163](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L163)

***

### otherTransferBytes

> `readonly` **otherTransferBytes**: `number`

Defined in: [driver/src/api.ts:166](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L166)

***

### peakJobMemoryBytes

> `readonly` **peakJobMemoryBytes**: `number`

Defined in: [driver/src/api.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L160)

Peak committed memory charged to one Job Object; this is not RSS.

***

### readOperationCount

> `readonly` **readOperationCount**: `number`

Defined in: [driver/src/api.ts:161](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L161)

***

### readTransferBytes

> `readonly` **readTransferBytes**: `number`

Defined in: [driver/src/api.ts:164](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L164)

***

### source

> `readonly` **source**: `"windows-job-object"`

Defined in: [driver/src/api.ts:156](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L156)

***

### totalProcesses

> `readonly` **totalProcesses**: `number`

Defined in: [driver/src/api.ts:167](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L167)

***

### totalTerminatedProcesses

> `readonly` **totalTerminatedProcesses**: `number`

Defined in: [driver/src/api.ts:169](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L169)

***

### userTime100ns

> `readonly` **userTime100ns**: `number`

Defined in: [driver/src/api.ts:157](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L157)

***

### writeOperationCount

> `readonly` **writeOperationCount**: `number`

Defined in: [driver/src/api.ts:162](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L162)

***

### writeTransferBytes

> `readonly` **writeTransferBytes**: `number`

Defined in: [driver/src/api.ts:165](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L165)
