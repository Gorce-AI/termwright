---
title: "Interface: LaunchOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LaunchOptions

# Interface: LaunchOptions

Defined in: [driver/src/api.ts:86](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L86)

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

### artifactValuePolicy?

> `readonly` `optional` **artifactValuePolicy?**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: [driver/src/api.ts:134](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L134)

Values copied into receipts/traces. Defaults to `redacted`; `raw` is explicit opt-in.

***

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [driver/src/api.ts:112](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L112)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [driver/src/api.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L87)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [driver/src/api.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L88)

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: [driver/src/api.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L96)

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [driver/src/api.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L89)

***

### envMode?

> `readonly` `optional` **envMode?**: [`EnvMode`](../../type-aliases/envmode/)

Defined in: [driver/src/api.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L91)

Defaults to `'replace'`: a test process's secrets are not the child's.

***

### logs?

> `readonly` `optional` **logs?**: readonly [`AppLogSource`](../applogsource/)[]

Defined in: [driver/src/api.ts:102](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L102)

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

***

### operationBudget?

> `readonly` `optional` **operationBudget?**: [`OperationBudget`](../operationbudget/)

Defined in: [driver/src/api.ts:131](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L131)

***

### recording?

> `readonly` `optional` **recording?**: [`RecordingOptions`](../recordingoptions/)

Defined in: [driver/src/api.ts:132](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L132)

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"focus"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"pointer-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: [driver/src/api.ts:145](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L145)

Capabilities that must be present in the frozen session contract.
Launch waits for negotiation and throws `CapabilityUnavailableError`
before returning a harness when any requirement is missing.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [driver/src/api.ts:113](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L113)

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: [driver/src/api.ts:129](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L129)

***

### semanticFrameQueueCapacity?

> `readonly` `optional` **semanticFrameQueueCapacity?**: `number`

Defined in: [driver/src/api.ts:128](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L128)

Negotiated ceiling for semantic frames in flight between a framework
probe and the driver. Defaults to 32 and is capped at 256. Compatible
probes may use it as their publication budget; a full queue still fails
closed instead of dropping or retrying a semantic revision.

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [driver/src/api.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L121)

Maximum time to discover an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. A peer accepted within that window keeps
its own bounded hello deadline; peers first seen afterwards are refused.
When `requiredCapabilities` is non-empty, the default discovery budget is
the larger of 2,000 ms and the session `ready` timeout.

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [driver/src/api.ts:139](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L139)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [driver/src/api.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L111)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. The built-in ids are `'default'` and
`'cjk-wide'`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TimeoutClasses`](../timeoutclasses/)

Defined in: [driver/src/api.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L130)
