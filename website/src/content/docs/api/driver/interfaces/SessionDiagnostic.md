---
title: "Interface: SessionDiagnostic"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionDiagnostic

# Interface: SessionDiagnostic

Defined in: [api.ts:718](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L718)

One entry of the session diagnostics log.

## Properties

### code

> `readonly` **code**: [`DiagnosticCode`](../../type-aliases/diagnosticcode/)

Defined in: [api.ts:719](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L719)

***

### count?

> `readonly` `optional` **count?**: `number`

Defined in: [api.ts:733](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L733)

How many items the entry accounts for, when it stands for several — the
number that would otherwise be readable only by parsing [detail](#detail).

Present on aggregate entries: records an adapter dropped upstream, records
or lines the driver refused over budget. Absent when the entry is about one
identified thing (a single revision, a single refused duplicate), because
there is nothing to count there. Summing `count` over `log-dropped`
entries therefore answers "how many log entries never reached me".

***

### detail

> `readonly` **detail**: `string`

Defined in: [api.ts:720](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L720)

***

### mode?

> `readonly` `optional` **mode?**: `"mouse"` \| `"focus"`

Defined in: [api.ts:744](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L744)

For `mode-unverifiable`: which mode could not be verified. A field rather
than a code per mode, so a consumer reacting to "the driver is working
blind" writes one branch instead of a list that grows with the platform.

***

### revision?

> `readonly` `optional` **revision?**: `number`

Defined in: [api.ts:722](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L722)

The semantic revision the entry is about, when it is about one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [api.ts:745](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L745)

***

### wireCode?

> `readonly` `optional` **wireCode?**: `"bad-token"` \| `"bad-version"` \| `"malformed"` \| `"limit-exceeded"` \| `"internal"`

Defined in: [api.ts:738](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L738)

For `protocol-violation`: the wire error code sent to the adapter, so a
caller can tell *which* failure closed the channel without parsing prose.
