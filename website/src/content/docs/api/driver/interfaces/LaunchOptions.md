---
title: "Interface: LaunchOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LaunchOptions

# Interface: LaunchOptions

Defined in: [api.ts:64](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L64)

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

## Extended by

- [`LaunchTerminalOptions`](../launchterminaloptions/)

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [api.ts:105](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L105)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [api.ts:65](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L65)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [api.ts:66](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L66)

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: [api.ts:74](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L74)

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [api.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L67)

***

### envMode?

> `readonly` `optional` **envMode?**: [`EnvMode`](../../type-aliases/envmode/)

Defined in: [api.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L69)

Defaults to `'replace'`: a test process's secrets are not the child's.

***

### logs?

> `readonly` `optional` **logs?**: readonly [`AppLogSource`](../applogsource/)[]

Defined in: [api.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L80)

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

***

### recording?

> `readonly` `optional` **recording?**: [`RecordingOptions`](../recordingoptions/)

Defined in: [api.ts:110](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L110)

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [api.ts:106](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L106)

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: [api.ts:108](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L108)

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [api.ts:107](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L107)

***

### semanticProtocol?

> `readonly` `optional` **semanticProtocol?**: `"termwright/1"` \| `"termwright/2"`

Defined in: [api.ts:104](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L104)

Semantic wire major. V2 is the default and requires evidence-qualified
geometry, visibility and exact hit grids. V1 is an explicit compatibility
mode for older producers; it never enables unqualified pointer actions.

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [api.ts:115](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L115)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [api.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L89)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
`'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TimeoutClasses`](../timeoutclasses/)

Defined in: [api.ts:109](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L109)

***

### treeUpdates?

> `readonly` `optional` **treeUpdates?**: `"auto"` \| `"snapshots"`

Defined in: [api.ts:98](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L98)

How an instrumented application should push its semantic tree.

`'auto'` (default) takes deltas from any adapter that offers them, which
is far cheaper for a tree that changes on every keystroke. `'snapshots'`
forces full trees — the switch to reach for when a replay and a live
session disagree and the delta path is a suspect.
