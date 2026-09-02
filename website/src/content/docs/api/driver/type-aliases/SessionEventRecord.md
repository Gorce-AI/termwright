---
title: "Type Alias: SessionEventRecord"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventRecord

# Type Alias: SessionEventRecord

> **SessionEventRecord** = `{ [E in keyof SessionEventMap]: Readonly<{ payload: SessionEventMap[E]; sequence: number; type: E }> }`\[keyof [`SessionEventMap`](../../interfaces/sessioneventmap/)\]

Defined in: [driver/src/api.ts:1103](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1103)

One globally ordered record retained by the bounded session journal.
