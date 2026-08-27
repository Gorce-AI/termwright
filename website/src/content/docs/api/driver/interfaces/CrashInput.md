---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:973](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L973)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:976](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L976)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:975](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L975)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:981](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L981)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:974](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L974)
