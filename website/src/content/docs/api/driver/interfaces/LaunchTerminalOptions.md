---
title: "Interface: LaunchTerminalOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LaunchTerminalOptions

# Interface: LaunchTerminalOptions

Defined in: [driver/src/session.ts:210](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L210)

Stable application-facing options accepted by [launchTerminal](../../functions/launchterminal/).

## Extends

- [`LaunchOptions`](../launchoptions/)

## Properties

### artifactValuePolicy?

> `readonly` `optional` **artifactValuePolicy?**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: [driver/src/api.ts:134](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L134)

Values copied into receipts/traces. Defaults to `redacted`; `raw` is explicit opt-in.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`artifactValuePolicy`](../launchoptions/#artifactvaluepolicy)

***

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [driver/src/api.ts:112](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L112)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`columns`](../launchoptions/#columns)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [driver/src/api.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L87)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`command`](../launchoptions/#command)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [driver/src/api.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L88)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`cwd`](../launchoptions/#cwd)

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: [driver/src/api.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L96)

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`debug`](../launchoptions/#debug)

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [driver/src/api.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L89)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`env`](../launchoptions/#env)

***

### envMode?

> `readonly` `optional` **envMode?**: [`EnvMode`](../../type-aliases/envmode/)

Defined in: [driver/src/api.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L91)

Defaults to `'replace'`: a test process's secrets are not the child's.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`envMode`](../launchoptions/#envmode)

***

### logs?

> `readonly` `optional` **logs?**: readonly [`AppLogSource`](../applogsource/)[]

Defined in: [driver/src/api.ts:102](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L102)

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`logs`](../launchoptions/#logs)

***

### modesObservable?

> `readonly` `optional` **modesObservable?**: `boolean`

Defined in: [driver/src/session.ts:216](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L216)

Whether the child's input-mode requests are observable. Defaults to true
for every certified backend, including pinned passthrough ConPTY. Set false
only for an embedding or synthetic backend that cannot expose DECSET.

***

### operationBudget?

> `readonly` `optional` **operationBudget?**: [`OperationBudget`](../operationbudget/)

Defined in: [driver/src/api.ts:131](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L131)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`operationBudget`](../launchoptions/#operationbudget)

***

### recording?

> `readonly` `optional` **recording?**: [`RecordingOptions`](../recordingoptions/)

Defined in: [driver/src/api.ts:132](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L132)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`recording`](../launchoptions/#recording)

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"focus"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"pointer-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: [driver/src/api.ts:145](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L145)

Capabilities that must be present in the frozen session contract.
Launch waits for negotiation and throws `CapabilityUnavailableError`
before returning a harness when any requirement is missing.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`requiredCapabilities`](../launchoptions/#requiredcapabilities)

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [driver/src/api.ts:113](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L113)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`rows`](../launchoptions/#rows)

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: [driver/src/api.ts:129](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L129)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`scrollbackLines`](../launchoptions/#scrollbacklines)

***

### semanticFrameQueueCapacity?

> `readonly` `optional` **semanticFrameQueueCapacity?**: `number`

Defined in: [driver/src/api.ts:128](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L128)

Negotiated ceiling for semantic frames in flight between a framework
probe and the driver. Defaults to 32 and is capped at 256. Compatible
probes may use it as their publication budget; a full queue still fails
closed instead of dropping or retrying a semantic revision.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`semanticFrameQueueCapacity`](../launchoptions/#semanticframequeuecapacity)

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [driver/src/api.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L121)

Maximum time to discover an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. A peer accepted within that window keeps
its own bounded hello deadline; peers first seen afterwards are refused.
When `requiredCapabilities` is non-empty, the default discovery budget is
the larger of 2,000 ms and the session `ready` timeout.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`semanticNegotiationMs`](../launchoptions/#semanticnegotiationms)

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [driver/src/api.ts:139](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L139)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`shellIntegration`](../launchoptions/#shellintegration)

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [driver/src/api.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L111)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. The built-in ids are `'default'` and
`'cjk-wide'`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`terminalProfile`](../launchoptions/#terminalprofile)

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TimeoutClasses`](../timeoutclasses/)

Defined in: [driver/src/api.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L130)

#### Inherited from

[`LaunchOptions`](../launchoptions/).[`timeouts`](../launchoptions/#timeouts)
