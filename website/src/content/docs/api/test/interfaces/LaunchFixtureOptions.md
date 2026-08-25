---
title: "Interface: LaunchFixtureOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / LaunchFixtureOptions

# Interface: LaunchFixtureOptions

Defined in: [test/src/fixtures.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L62)

What a test may override when launching a program.

## Extends

- `Omit`\<`LaunchOptions`, `"command"` \| `"operationBudget"`\>

## Properties

### artifactValuePolicy?

> `readonly` `optional` **artifactValuePolicy?**: `"none"` \| `"redacted"` \| `"raw"`

Defined in: driver/dist/session-Qtj2njLI.d.ts:80

Values copied into receipts/traces. Defaults to `redacted`; `raw` is explicit opt-in.

#### Inherited from

`Omit.artifactValuePolicy`

***

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: driver/dist/session-Qtj2njLI.d.ts:67

#### Inherited from

`Omit.columns`

***

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/fixtures.ts:64](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L64)

Defaults to `config.command`.

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: driver/dist/session-Qtj2njLI.d.ts:43

#### Inherited from

`Omit.cwd`

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: driver/dist/session-Qtj2njLI.d.ts:51

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

#### Inherited from

`Omit.debug`

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:44

#### Inherited from

`Omit.env`

***

### envMode?

> `readonly` `optional` **envMode?**: `EnvMode`

Defined in: driver/dist/session-Qtj2njLI.d.ts:46

Defaults to `'replace'`: a test process's secrets are not the child's.

#### Inherited from

`Omit.envMode`

***

### files?

> `readonly` `optional` **files?**: `Readonly`\<`Record`\<`string`, [`SeedFile`](../../type-aliases/seedfile/)\>\>

Defined in: [test/src/fixtures.ts:76](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L76)

Files to create in the working directory before the program starts, keyed
by relative path. Directories are created as needed.

#### Example

```ts
await terminal.launch({
  files: { 'config.json': '{"theme":"dark"}', 'notes/todo.md': '- write tests\n' },
});
```

***

### logs?

> `readonly` `optional` **logs?**: readonly `AppLogSource`[]

Defined in: driver/dist/session-Qtj2njLI.d.ts:57

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

#### Inherited from

`Omit.logs`

***

### recording?

> `readonly` `optional` **recording?**: `RecordingOptions`

Defined in: driver/dist/session-Qtj2njLI.d.ts:78

#### Inherited from

`Omit.recording`

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"focus"` \| `"pointer-input"` \| `"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"scroll"` \| `"render-order"` \| `"action-strategies"` \| `"keyboard-input"` \| `"focus-input"` \| `"paired-revisions"`)[]

Defined in: driver/dist/session-Qtj2njLI.d.ts:91

Capabilities that must be present in the frozen session contract.
Launch waits for negotiation and throws `CapabilityUnavailableError`
before returning a harness when any requirement is missing.

#### Inherited from

`Omit.requiredCapabilities`

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: driver/dist/session-Qtj2njLI.d.ts:68

#### Inherited from

`Omit.rows`

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: driver/dist/session-Qtj2njLI.d.ts:75

#### Inherited from

`Omit.scrollbackLines`

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: driver/dist/session-Qtj2njLI.d.ts:74

Maximum time to wait for an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. When `requiredCapabilities` is non-empty,
the default is the larger of 2,000 ms and the session `ready` timeout.

#### Inherited from

`Omit.semanticNegotiationMs`

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: driver/dist/session-Qtj2njLI.d.ts:85

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

#### Inherited from

`Omit.shellIntegration`

***

### template?

> `readonly` `optional` **template?**: `string` \| [`SeedTemplate`](../seedtemplate/)

Defined in: [test/src/fixtures.ts:81](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L81)

A directory to copy in first, so a test can start from a whole project and
change only what it is about. `files` are written over it.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: driver/dist/session-Qtj2njLI.d.ts:66

Terminal profile: which width tables and which of the switches terminals
disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
`'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.

It is recorded with the session so a replay, a screenshot and the runner
pane can count characters exactly as the live session did.

#### Inherited from

`Omit.terminalProfile`

***

### timeouts?

> `readonly` `optional` **timeouts?**: `TimeoutClasses`

Defined in: driver/dist/session-Qtj2njLI.d.ts:76

#### Inherited from

`Omit.timeouts`

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/fixtures.ts:83](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L83)

Trace policy for this session, overriding the file's and the project's.
