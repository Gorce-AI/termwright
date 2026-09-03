---
title: "Interface: ColorPalette"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ColorPalette

# Interface: ColorPalette

Defined in: [test/src/config.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L46)

A deterministic 16-entry ANSI palette.

Terminals differ in what `palette index 2` looks like; pinning the palette
per profile is what makes color assertions and cell snapshots stable across
a developer machine and CI.

## Properties

### colors

> `readonly` **colors**: readonly `string`[]

Defined in: [test/src/config.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L49)

`#rrggbb` for palette indices 0…15, in ANSI order.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/config.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L51)

Extra environment handed to launched programs, e.g. `TERM`.

***

### name

> `readonly` **name**: `string`

Defined in: [test/src/config.ts:47](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L47)
