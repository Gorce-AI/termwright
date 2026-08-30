---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:937](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L937)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:940](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L940)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:939](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L939)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:945](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L945)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:938](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L938)
