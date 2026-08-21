---
title: "Function: seedDirectory()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / seedDirectory

# Function: seedDirectory()

> **seedDirectory**(`directory`, `options`): readonly `string`[]

Defined in: [test/src/seed.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/seed.ts#L46)

Creates the declared files inside `directory`.

A template is copied first and the declared files are written over it, so a
test can take a whole project as its starting point and change the one file
it is about.

## Parameters

### directory

`string`

### options

[`SeedOptions`](../../interfaces/seedoptions/)

## Returns

readonly `string`[]

## Throws

TypeError when a path would leave `directory`. A test that writes
outside its own directory is not isolated, and `../../.ssh/config` is the
kind of typo that should stop a run rather than land somewhere real.
