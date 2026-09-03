---
title: "Interface: PtyBackendChoice"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackendChoice

# Interface: PtyBackendChoice

Defined in: [backend-selection.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/backend-selection.ts#L14)

## Properties

### backend

> `readonly` **backend**: [`PtyBackend`](../ptybackend/)

Defined in: [backend-selection.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/backend-selection.ts#L15)

***

### degradedReason?

> `readonly` `optional` **degradedReason?**: `string`

Defined in: [backend-selection.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/backend-selection.ts#L21)

Retained for callers that report on the choice. Every supported platform
now has exactly one backend, so nothing sets it; a future platform with a
weaker second implementation would.
