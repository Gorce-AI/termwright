---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:965](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L965)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:968](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L968)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:967](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L967)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:973](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L973)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:966](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L966)
