---
title: "Type Alias: Observation\\<T\\>"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Observation

# Type Alias: Observation\<T\>

> **Observation**\<`T`\> = \{ `evidence`: `ObservationEvidence`; `status`: `"known"`; `value`: `T`; \} \| \{ `evidence`: `AuthoritativeObservationEvidence`; `reason`: `ObservationAbsentReason`; `status`: `"absent"`; \} \| \{ `reason`: `ObservationUnknownReason`; `status`: `"unknown"`; \} \| \{ `capability`: `string`; `reason`: `ObservationUnsupportedReason`; `status`: `"unsupported"`; \}

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:477

A fact with its epistemic state preserved.

Consumers must never coerce `unknown`/`unsupported` to false, nor absence to
an empty value. That rule prevents assertions from passing because a probe
simply could not observe the requested property.

## Type Parameters

### T

`T`
