---
title: "Interface: ErrorDiagnostics"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ErrorDiagnostics

# Interface: ErrorDiagnostics

Defined in: [driver/src/api.ts:1218](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1218)

`@termwright/driver` — PTY + VT sessions, locators, actions and waits.

The normative public API lives in `api.ts`; this module is the only entry
point and re-exports the types from there together with their runtime
implementations.

## Example

```ts
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('Ready');
await terminal.getByRole('button', { name: 'Approve' }).activate();
await terminal.close();
```

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`ResolvedTarget`](../resolvedtarget/)\<[`LocatorDomain`](../../type-aliases/locatordomain/)\>[]

Defined in: [driver/src/api.ts:1221](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1221)

***

### lastObserved?

> `readonly` `optional` **lastObserved?**: `string`

Defined in: [driver/src/api.ts:1224](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1224)

Bounded rendering of the final value seen by a retrying wait.

***

### observation?

> `readonly` `optional` **observation?**: `object`

Defined in: [driver/src/api.ts:1226](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1226)

Exact reason a terminal/semantic observation has not committed yet.

#### openFrameRevisions

> `readonly` **openFrameRevisions**: readonly `number`[]

#### pendingMarkerRevisions

> `readonly` **pendingMarkerRevisions**: readonly `number`[]

#### pendingTreeRevisions

> `readonly` **pendingTreeRevisions**: readonly `number`[]

#### providerEvidenceInvalidAfterRevision

> `readonly` **providerEvidenceInvalidAfterRevision**: `number` \| `null`

#### publishedRevision

> `readonly` **publishedRevision**: `number` \| `null`

#### state

> `readonly` **state**: `"parser-in-flight"` \| `"semantic-frame-open"` \| `"pairing-pending"`

***

### screenExcerpt?

> `readonly` `optional` **screenExcerpt?**: `string`

Defined in: [driver/src/api.ts:1219](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1219)

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [driver/src/api.ts:1220](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1220)

***

### suggestion?

> `readonly` `optional` **suggestion?**: `string`

Defined in: [driver/src/api.ts:1222](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1222)
