---
title: "Interface: SessionDiagnostic"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionDiagnostic

# Interface: SessionDiagnostic

Defined in: [driver/src/api.ts:829](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L829)

One entry of the session diagnostics log.

## Properties

### code

> `readonly` **code**: [`DiagnosticCode`](../../type-aliases/diagnosticcode/)

Defined in: [driver/src/api.ts:830](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L830)

***

### count?

> `readonly` `optional` **count?**: `number`

Defined in: [driver/src/api.ts:844](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L844)

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

Defined in: [driver/src/api.ts:831](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L831)

***

### mode?

> `readonly` `optional` **mode?**: `"mouse"` \| `"focus"`

Defined in: [driver/src/api.ts:855](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L855)

For `mode-unverifiable`: which mode could not be verified. A field rather
than a code per mode, so a consumer reacting to "the driver is working
blind" writes one branch instead of a list that grows with the platform.

***

### revision?

> `readonly` `optional` **revision?**: `number`

Defined in: [driver/src/api.ts:833](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L833)

The semantic revision the entry is about, when it is about one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:856](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L856)

***

### wireCode?

> `readonly` `optional` **wireCode?**: `"adapter-guarantee-violation"` \| `"duplicate-semantic-key"` \| `"bad-token"` \| `"bad-version"` \| `"malformed"` \| `"limit-exceeded"` \| `"capability-provider-violation"` \| `"internal"`

Defined in: [driver/src/api.ts:849](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L849)

For `protocol-violation`: the wire error code sent to the adapter, so a
caller can tell *which* failure closed the channel without parsing prose.
