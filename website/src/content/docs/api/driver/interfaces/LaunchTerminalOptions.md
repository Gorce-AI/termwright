---
title: "Interface: LaunchTerminalOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LaunchTerminalOptions

# Interface: LaunchTerminalOptions

Defined in: [session.ts:165](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L165)

Options accepted by [launchTerminal](../../functions/launchterminal/), plus the injectable backend.

## Extends

- [`LaunchOptions`](../launchoptions/)

## Properties

### backend?

> `readonly` `optional` **backend?**: [`PtyBackend`](../ptybackend/)

Defined in: [session.ts:167](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L167)

Defaults to `@lydell/node-pty`; swapped by component-testing harnesses.

***

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [api.ts:105](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L105)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`columns`](../launchoptions/#columns)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [api.ts:65](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L65)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`command`](../launchoptions/#command)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [api.ts:66](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L66)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`cwd`](../launchoptions/#cwd)

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: [api.ts:74](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L74)

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`debug`](../launchoptions/#debug)

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [api.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L67)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`env`](../launchoptions/#env)

***

### envMode?

> `readonly` `optional` **envMode?**: [`EnvMode`](../../type-aliases/envmode/)

Defined in: [api.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L69)

Defaults to `'replace'`: a test process's secrets are not the child's.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`envMode`](../launchoptions/#envmode)

***

### logs?

> `readonly` `optional` **logs?**: readonly [`AppLogSource`](../applogsource/)[]

Defined in: [api.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L80)

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`logs`](../launchoptions/#logs)

***

### modesObservable?

> `readonly` `optional` **modesObservable?**: `boolean`

Defined in: [session.ts:174](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L174)

Whether the child's mouse mode requests are observable. Defaults to the
platform's answer (false under ConPTY). Overridable so the unobservable
path can be exercised on a machine where modes do arrive — a behaviour
only one OS reaches is a behaviour only one OS tests.

***

### recording?

> `readonly` `optional` **recording?**: [`RecordingOptions`](../recordingoptions/)

Defined in: [api.ts:110](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L110)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`recording`](../launchoptions/#recording)

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [api.ts:106](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L106)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`rows`](../launchoptions/#rows)

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: [api.ts:108](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L108)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`scrollbackLines`](../launchoptions/#scrollbacklines)

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [api.ts:107](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L107)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`semanticNegotiationMs`](../launchoptions/#semanticnegotiationms)

***

### semanticProtocol?

> `readonly` `optional` **semanticProtocol?**: `"termwright/1"` \| `"termwright/2"`

Defined in: [api.ts:104](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L104)

Semantic wire major. V2 is the default and requires evidence-qualified
geometry, visibility and exact hit grids. V1 is an explicit compatibility
mode for older producers; it never enables unqualified pointer actions.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`semanticProtocol`](../launchoptions/#semanticprotocol)

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [api.ts:115](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L115)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`shellIntegration`](../launchoptions/#shellintegration)

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [api.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L89)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
`'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`terminalProfile`](../launchoptions/#terminalprofile)

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TimeoutClasses`](../timeoutclasses/)

Defined in: [api.ts:109](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L109)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`timeouts`](../launchoptions/#timeouts)

***

### treeUpdates?

> `readonly` `optional` **treeUpdates?**: `"auto"` \| `"snapshots"`

Defined in: [api.ts:98](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L98)

How an instrumented application should push its semantic tree.

`'auto'` (default) takes deltas from any adapter that offers them, which
is far cheaper for a tree that changes on every keystroke. `'snapshots'`
forces full trees — the switch to reach for when a replay and a live
session disagree and the delta path is a suspect.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`treeUpdates`](../launchoptions/#treeupdates)
