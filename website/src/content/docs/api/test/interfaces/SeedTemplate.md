---
title: "Interface: SeedTemplate"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SeedTemplate

# Interface: SeedTemplate

Defined in: [test/src/seed.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L30)

A directory to copy in before the files are written.

## Properties

### from

> `readonly` **from**: `string`

Defined in: [test/src/seed.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L32)

Directory to copy from; relative paths resolve against the test's cwd.

***

### into?

> `readonly` `optional` **into?**: `string`

Defined in: [test/src/seed.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L34)

Subdirectory of the test's directory to copy into. Default: the root.
