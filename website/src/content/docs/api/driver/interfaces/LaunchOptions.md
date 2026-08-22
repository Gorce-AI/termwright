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

Defined in: [driver/src/api.ts:125](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L125)

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

Defined in: [driver/src/api.ts:122](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L122)

***

### recording?

> `readonly` `optional` **recording?**: [`RecordingOptions`](../recordingoptions/)

Defined in: [driver/src/api.ts:123](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L123)

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"focus"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"pointer-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: [driver/src/api.ts:137](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L137)

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

Defined in: [driver/src/api.ts:120](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L120)

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [driver/src/api.ts:119](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L119)

Maximum time to wait for an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. When `requiredCapabilities` is non-empty,
the default is the larger of 2,000 ms and the session `ready` timeout.

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [driver/src/api.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L130)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [driver/src/api.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L111)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
`'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TimeoutClasses`](../timeoutclasses/)

Defined in: [driver/src/api.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L121)
