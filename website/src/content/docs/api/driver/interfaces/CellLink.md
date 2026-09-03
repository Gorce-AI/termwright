---
title: "Interface: CellLink"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellLink

# Interface: CellLink

Defined in: [driver/src/api.ts:427](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L427)

A hyperlink attached to a cell.

`id` is the OSC 8 `id=` parameter. It is the only parameter that survives:
the sequence permits `key=value:key=value`, and the emulator keeps `id` and
discards the rest — so anything carrying data through a hyperlink has this
one field to carry it in.

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [driver/src/api.ts:429](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L429)

***

### truncated?

> `readonly` `optional` **truncated?**: `true`

Defined in: [driver/src/api.ts:435](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L435)

True when `uri` was cut to the string ceiling and is therefore **not** the
address the program wrote. Present only when it happened, so an assertion
against a URI can tell "this is the link" from "this is the front of it".

***

### uri

> `readonly` **uri**: `string`

Defined in: [driver/src/api.ts:428](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L428)
