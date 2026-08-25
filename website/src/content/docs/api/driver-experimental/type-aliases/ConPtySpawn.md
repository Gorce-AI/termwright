---
title: "Type Alias: ConPtySpawn"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / ConPtySpawn

# Type Alias: ConPtySpawn

> **ConPtySpawn** = (`options`) => [`ConPtySessionHandle`](../../interfaces/conptysessionhandle/)

Defined in: [conpty-backend.ts:43](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L43)

The spawn entry point, injected so the translation is testable off Windows.

## Parameters

### options

#### columns

`number`

#### command

readonly `string`[]

#### cwd?

`string`

#### env

`Readonly`\<`Record`\<`string`, `string`\>\>

#### rows

`number`

## Returns

[`ConPtySessionHandle`](../../interfaces/conptysessionhandle/)
