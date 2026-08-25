---
title: "Interface: LaunchTerminalWithBackendOptions"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / LaunchTerminalWithBackendOptions

# Interface: LaunchTerminalWithBackendOptions

Defined in: [session.ts:233](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L233)

Low-level integration options exported only from `@termwright/driver/experimental`.

## Extends

- `LaunchTerminalOptions`

## Properties

### artifactValuePolicy?

> `readonly` `optional` **artifactValuePolicy?**: `"none"` \| `"redacted"` \| `"raw"`

Defined in: [api.ts:125](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L125)

Values copied into receipts/traces. Defaults to `redacted`; `raw` is explicit opt-in.

#### Inherited from

`LaunchTerminalOptions.artifactValuePolicy`

***

### backend

> `readonly` **backend**: [`PtyBackend`](../ptybackend/)

Defined in: [session.ts:234](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L234)

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

Defined in: [session.ts:229](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L229)

Whether the child's mouse mode requests are observable. Defaults to the
platform's answer (false under ConPTY). Framework integrations may pin the
value when their transport has stronger knowledge than the host platform.

#### Inherited from

`LaunchTerminalOptions.modesObservable`

***

### operationBudget?

> `readonly` `optional` **operationBudget?**: `OperationBudget`

Defined in: [api.ts:122](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L122)

#### Inherited from

`LaunchTerminalOptions.operationBudget`

***

### recording?

> `readonly` `optional` **recording?**: `RecordingOptions`

Defined in: [api.ts:123](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L123)

#### Inherited from

`LaunchTerminalOptions.recording`

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"focus"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"pointer-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: [api.ts:137](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L137)

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

Defined in: [api.ts:120](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L120)

#### Inherited from

`LaunchTerminalOptions.scrollbackLines`

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [api.ts:119](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L119)

Maximum time to wait for an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. When `requiredCapabilities` is non-empty,
the default is the larger of 2,000 ms and the session `ready` timeout.

#### Inherited from

`LaunchTerminalOptions.semanticNegotiationMs`

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [api.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L130)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

#### Inherited from

`LaunchTerminalOptions.shellIntegration`

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [api.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L111)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
`'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

#### Inherited from

`LaunchTerminalOptions.terminalProfile`

***

### timeouts?

> `readonly` `optional` **timeouts?**: `TimeoutClasses`

Defined in: [api.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L121)

#### Inherited from

`LaunchTerminalOptions.timeouts`
