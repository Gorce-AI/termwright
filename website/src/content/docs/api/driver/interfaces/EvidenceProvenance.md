---
title: "Interface: EvidenceProvenance"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EvidenceProvenance

# Interface: EvidenceProvenance

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:727

Where a fact originated, how it was obtained, and what consumers may infer.

## Properties

### method

> `readonly` **method**: `"heuristic"` \| `"native"` \| `"instrumented"` \| `"declared"` \| `"correlated"` \| `"measured"` \| `"derived"`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:729

***

### providerId

> `readonly` **providerId**: `string`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:732

Stable identity of the producer, never a display label.

***

### source

> `readonly` **source**: `"application"` \| `"recognizer"` \| `"framework"` \| `"terminal"` \| `"driver"`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:728

***

### strength

> `readonly` **strength**: `"diagnostic"` \| `"authoritative"`

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:730
