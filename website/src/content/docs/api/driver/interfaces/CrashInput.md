---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:1014](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1014)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:1017](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1017)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:1016](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1016)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:1022](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1022)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1015](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1015)
