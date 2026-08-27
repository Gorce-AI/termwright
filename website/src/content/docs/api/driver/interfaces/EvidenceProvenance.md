---
title: "Interface: EvidenceProvenance"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EvidenceProvenance

# Interface: EvidenceProvenance

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:692

Where a fact originated, how it was obtained, and what consumers may infer.

## Properties

### method

> `readonly` **method**: `"heuristic"` \| `"native"` \| `"instrumented"` \| `"declared"` \| `"correlated"` \| `"measured"` \| `"derived"`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:694

***

### providerId

> `readonly` **providerId**: `string`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:697

Stable identity of the producer, never a display label.

***

### source

> `readonly` **source**: `"application"` \| `"recognizer"` \| `"framework"` \| `"terminal"` \| `"driver"`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:693

***

### strength

> `readonly` **strength**: `"diagnostic"` \| `"authoritative"`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:695
