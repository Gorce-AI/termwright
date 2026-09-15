---
title: "Interface: TerminalObservation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalObservation

# Interface: TerminalObservation

Defined in: [driver/src/api.ts:173](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L173)

Screen and semantic state captured from one committed observation boundary.

## Properties

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:174](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L174)

***

### screen

> `readonly` **screen**: [`ScreenSnapshot`](../screensnapshot/)

Defined in: [driver/src/api.ts:175](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L175)

***

### semanticTree

> `readonly` **semanticTree**: `SemanticSnapshot` \| `null`

Defined in: [driver/src/api.ts:176](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L176)
