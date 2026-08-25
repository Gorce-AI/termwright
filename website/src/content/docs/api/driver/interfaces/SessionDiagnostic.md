---
title: "Interface: SessionDiagnostic"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionDiagnostic

# Interface: SessionDiagnostic

Defined in: [driver/src/api.ts:1060](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1060)

One entry of the session diagnostics log.

## Properties

### actionId?

> `readonly` `optional` **actionId?**: `string`

Defined in: [driver/src/api.ts:1066](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1066)

Correlates an action-observation wait with its action lifecycle.

***

### code

> `readonly` **code**: [`DiagnosticCode`](../../type-aliases/diagnosticcode/)

Defined in: [driver/src/api.ts:1061](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1061)

***

### count?

> `readonly` `optional` **count?**: `number`

Defined in: [driver/src/api.ts:1082](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1082)

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

Defined in: [driver/src/api.ts:1062](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1062)

***

### mode?

> `readonly` `optional` **mode?**: `"mouse"` \| `"focus"`

Defined in: [driver/src/api.ts:1093](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1093)

For `mode-unverifiable`: which mode could not be verified. A field rather
than a code per mode, so a consumer reacting to "the driver is working
blind" writes one branch instead of a list that grows with the platform.

***

### observationState?

> `readonly` `optional` **observationState?**: `"parser-in-flight"` \| `"semantic-frame-open"` \| `"pairing-pending"`

Defined in: [driver/src/api.ts:1068](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1068)

The in-flight boundary an action is waiting to cross.

***

### revision?

> `readonly` `optional` **revision?**: `number`

Defined in: [driver/src/api.ts:1064](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1064)

The semantic revision the entry is about, when it is about one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1094](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1094)

***

### wireCode?

> `readonly` `optional` **wireCode?**: `"adapter-guarantee-violation"` \| `"duplicate-semantic-key"` \| `"bad-token"` \| `"bad-version"` \| `"malformed"` \| `"limit-exceeded"` \| `"capability-provider-violation"` \| `"internal"`

Defined in: [driver/src/api.ts:1087](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1087)

For `protocol-violation`: the wire error code sent to the adapter, so a
caller can tell *which* failure closed the channel without parsing prose.
