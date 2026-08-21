---
title: "Interface: LaunchOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LaunchOptions

# Interface: LaunchOptions

Defined in: [driver/src/api.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L70)

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

Defined in: [driver/src/api.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L96)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [driver/src/api.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L71)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [driver/src/api.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L72)

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: [driver/src/api.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L80)

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [driver/src/api.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L73)

***

### envMode?

> `readonly` `optional` **envMode?**: [`EnvMode`](../../type-aliases/envmode/)

Defined in: [driver/src/api.ts:75](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L75)

Defaults to `'replace'`: a test process's secrets are not the child's.

***

### logs?

> `readonly` `optional` **logs?**: readonly [`AppLogSource`](../applogsource/)[]

Defined in: [driver/src/api.ts:86](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L86)

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

***

### recording?

> `readonly` `optional` **recording?**: [`RecordingOptions`](../recordingoptions/)

Defined in: [driver/src/api.ts:101](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L101)

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"focus"` \| `"scroll"` \| `"render-order"` \| `"keyboard-input"` \| `"pointer-input"` \| `"paired-revisions"`)[]

Defined in: [driver/src/api.ts:112](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L112)

Capabilities that must be present in the frozen session contract.
Launch waits for negotiation and throws `CapabilityUnavailableError`
before returning a harness when any requirement is missing.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [driver/src/api.ts:97](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L97)

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: [driver/src/api.ts:99](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L99)

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: [driver/src/api.ts:98](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L98)

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: [driver/src/api.ts:106](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L106)

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [driver/src/api.ts:95](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L95)

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
`'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TimeoutClasses`](../timeoutclasses/)

Defined in: [driver/src/api.ts:100](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L100)
