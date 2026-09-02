---
title: "Type Alias: SemanticValueObservation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticValueObservation

# Type Alias: SemanticValueObservation

> **SemanticValueObservation** = \{ `evidence`: `ObservationEvidence`; `sensitivity`: `"public"` \| `"sensitive"`; `status`: `"known"`; `value`: `string`; \} \| \{ `evidence`: `AuthoritativeObservationEvidence`; `reason`: `SemanticValueAbsentReason`; `status`: `"absent"`; \} \| \{ `reason`: `ObservationUnknownReason`; `status`: `"unknown"`; \} \| \{ `capability`: `"semantic-value"`; `reason`: `ObservationUnsupportedReason`; `status`: `"unsupported"`; \} \| \{ `reason`: `SemanticValueWithheldReason`; `sensitivity`: `"public"` \| `"sensitive"`; `status`: `"withheld"`; \}

Defined in: protocol/dist/contract-DRS0RIwS.d.ts:66

A semantic value never collapses absence, uncertainty, support or confidentiality.
