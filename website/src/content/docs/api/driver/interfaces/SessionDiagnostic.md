---
title: "Interface: SessionDiagnostic"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionDiagnostic

# Interface: SessionDiagnostic

Defined in: [driver/src/api.ts:1041](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1041)

One entry of the session diagnostics log.

## Properties

### code

> `readonly` **code**: [`DiagnosticCode`](../../type-aliases/diagnosticcode/)

Defined in: [driver/src/api.ts:1042](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1042)

***

### count?

> `readonly` `optional` **count?**: `number`

Defined in: [driver/src/api.ts:1056](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1056)

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

Defined in: [driver/src/api.ts:1043](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1043)

***

### mode?

> `readonly` `optional` **mode?**: `"mouse"` \| `"focus"`

Defined in: [driver/src/api.ts:1067](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1067)

For `mode-unverifiable`: which mode could not be verified. A field rather
than a code per mode, so a consumer reacting to "the driver is working
blind" writes one branch instead of a list that grows with the platform.

***

### revision?

> `readonly` `optional` **revision?**: `number`

Defined in: [driver/src/api.ts:1045](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1045)

The semantic revision the entry is about, when it is about one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1068](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1068)

***

### wireCode?

> `readonly` `optional` **wireCode?**: `"adapter-guarantee-violation"` \| `"duplicate-semantic-key"` \| `"bad-token"` \| `"bad-version"` \| `"malformed"` \| `"limit-exceeded"` \| `"capability-provider-violation"` \| `"internal"`

Defined in: [driver/src/api.ts:1061](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1061)

For `protocol-violation`: the wire error code sent to the adapter, so a
caller can tell *which* failure closed the channel without parsing prose.
