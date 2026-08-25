---
title: "Function: createNodePtyBackend()"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / createNodePtyBackend

# Function: createNodePtyBackend()

> **createNodePtyBackend**(): [`PtyBackend`](../../interfaces/ptybackend/)

Defined in: [pty.ts:126](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L126)

The production backend: `@lydell/node-pty` pinned to 1.2.0-beta.15 (prebuilds for all
six platforms). The pty is opened with `encoding: null` so output arrives as
bytes; UTF-8 sequences split across reads are reassembled by the VT layer,
not here.

## Returns

[`PtyBackend`](../../interfaces/ptybackend/)
