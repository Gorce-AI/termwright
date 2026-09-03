---
title: "Interface: LaunchTerminalWithBackendOptions"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / LaunchTerminalWithBackendOptions

# Interface: LaunchTerminalWithBackendOptions

Defined in: [session.ts:220](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L220)

Low-level integration options exported only from `@termwright/driver/experimental`.

## Extends

- `LaunchTerminalOptions`

## Properties

### artifactSecurity?

> `readonly` `optional` **artifactSecurity?**: `ArtifactSecurityPolicy`

Defined in: [api.ts:134](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L134)

One policy for every artifact boundary. Defaults to secure `redacted`.

#### Inherited from

`LaunchTerminalOptions.artifactSecurity`

***

### backend

> `readonly` **backend**: [`PtyBackend`](../ptybackend/)

Defined in: [session.ts:221](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L221)

***

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [api.ts:112](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L112)

#### Inherited from

`LaunchTerminalOptions.columns`

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [api.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L87)

#### Inherited from

`LaunchTerminalOptions.command`

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [api.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L88)

#### Inherited from

`LaunchTerminalOptions.cwd`

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: [api.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L96)

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

#### Inherited from

`LaunchTerminalOptions.debug`

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [api.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L89)

#### Inherited from

`LaunchTerminalOptions.env`

***

### envMode?

> `readonly` `optional` **envMode?**: `EnvMode`

Defined in: [api.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L91)

Defaults to `'replace'`: a test process's secrets are not the child's.

#### Inherited from

`LaunchTerminalOptions.envMode`

***

### logs?

> `readonly` `optional` **logs?**: readonly `AppLogSource`[]

Defined in: [api.ts:102](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L102)

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

#### Inherited from

`LaunchTerminalOptions.logs`

***

### modesObservable?

> `readonly` `optional` **modesObservable?**: `boolean`

Defined in: [session.ts:216](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L216)

Whether the child's input-mode requests are observable. Defaults to true
for every certified backend, including pinned passthrough ConPTY. Set false
only for an embedding or synthetic backend that cannot expose DECSET.

#### Inherited from

`LaunchTerminalOptions.modesObservable`

***

### operationBudget?

> `readonly` `optional` **operationBudget?**: `OperationBudget`

Defined in: [api.ts:131](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L131)

#### Inherited from

`LaunchTerminalOptions.operationBudget`

***

### recording?

> `readonly` `optional` **recording?**: `RecordingOptions`

Defined in: [api.ts:132](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L132)

#### Inherited from

`LaunchTerminalOptions.recording`

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"focus"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"pointer-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: [api.ts:145](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L145)

Capabilities that must be present in the frozen session contract.
Launch waits for negotiation and throws `CapabilityUnavailableError`
before returning a harness when any requirement is missing.

#### Inherited from

`LaunchTerminalOptions.requiredCapabilities`

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [api.ts:113](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L113)

#### Inherited from

`LaunchTerminalOptions.rows`

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: [api.ts:129](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L129)

#### Inherited from

`LaunchTerminalOptions.scrollbackLines`

***

### semanticFrameQueueCapacity?

> `readonly` `optional` **semanticFrameQueueCapacity?**: `number`

Defined in: [api.ts:128](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L128)

Negotiated ceiling for semantic frames in flight between a framework
probe and the driver. Defaults to 32 and is capped at 256. Compatible
probes may use it as their publication budget; a full queue still fails
closed instead of dropping or retrying a semantic revision.

#### Inherited from

`LaunchTerminalOptions.semanticFrameQueueCapacity`

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [api.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L121)

Maximum time to discover an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. A peer accepted within that window keeps
its own bounded hello deadline; peers first seen afterwards are refused.
When `requiredCapabilities` is non-empty, the default discovery budget is
the larger of 2,000 ms and the session `ready` timeout.

#### Inherited from

`LaunchTerminalOptions.semanticNegotiationMs`

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [api.ts:139](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L139)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

#### Inherited from

`LaunchTerminalOptions.shellIntegration`

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [api.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L111)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. The built-in ids are `'default'` and
`'cjk-wide'`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

#### Inherited from

`LaunchTerminalOptions.terminalProfile`

***

### timeouts?

> `readonly` `optional` **timeouts?**: `TimeoutClasses`

Defined in: [api.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L130)

#### Inherited from

`LaunchTerminalOptions.timeouts`
