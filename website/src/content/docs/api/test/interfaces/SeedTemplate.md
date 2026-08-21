---
title: "Interface: SeedTemplate"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SeedTemplate

# Interface: SeedTemplate

Defined in: [test/src/seed.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L22)

A directory to copy in before the files are written.

## Properties

### from

> `readonly` **from**: `string`

Defined in: [test/src/seed.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L24)

Directory to copy from; relative paths resolve against the test's cwd.

***

### into?

> `readonly` `optional` **into?**: `string`

Defined in: [test/src/seed.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L26)

Subdirectory of the test's directory to copy into. Default: the root.
