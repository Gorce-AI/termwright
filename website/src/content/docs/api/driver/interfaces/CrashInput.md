---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [api.ts:633](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L633)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [api.ts:636](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L636)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [api.ts:635](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L635)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [api.ts:641](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L641)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [api.ts:634](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L634)
