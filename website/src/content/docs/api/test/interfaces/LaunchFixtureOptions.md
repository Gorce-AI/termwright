---
title: "Interface: LaunchFixtureOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / LaunchFixtureOptions

# Interface: LaunchFixtureOptions

Defined in: [test/src/fixtures.ts:48](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L48)

What a test may override when launching a program.

## Extends

- `Omit`\<`LaunchOptions`, `"command"`\>

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: driver/dist/index.d.ts:69

#### Inherited from

`Omit.columns`

***

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/fixtures.ts:50](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L50)

Defaults to `config.command`.

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: driver/dist/index.d.ts:45

#### Inherited from

`Omit.cwd`

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: driver/dist/index.d.ts:53

Streams a live log of API calls, waits, revisions and diagnostics to
stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).

#### Inherited from

`Omit.debug`

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: driver/dist/index.d.ts:46

#### Inherited from

`Omit.env`

***

### envMode?

> `readonly` `optional` **envMode?**: `EnvMode`

Defined in: driver/dist/index.d.ts:48

Defaults to `'replace'`: a test process's secrets are not the child's.

#### Inherited from

`Omit.envMode`

***

### files?

> `readonly` `optional` **files?**: `Readonly`\<`Record`\<`string`, [`SeedFile`](../../type-aliases/seedfile/)\>\>

Defined in: [test/src/fixtures.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L62)

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

Defined in: driver/dist/index.d.ts:59

Log files to follow for the lifetime of the session. A file that does not
exist yet is waited for; one that already exists is followed from its
current end, so a session never replays a previous run.

#### Inherited from

`Omit.logs`

***

### recording?

> `readonly` `optional` **recording?**: `RecordingOptions`

Defined in: driver/dist/index.d.ts:79

#### Inherited from

`Omit.recording`

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"focus"` \| `"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"scroll"` \| `"render-order"` \| `"keyboard-input"` \| `"pointer-input"` \| `"paired-revisions"`)[]

Defined in: driver/dist/index.d.ts:90

Capabilities that must be present in the frozen session contract.
Launch waits for negotiation and throws `CapabilityUnavailableError`
before returning a harness when any requirement is missing.

#### Inherited from

`Omit.requiredCapabilities`

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: driver/dist/index.d.ts:70

#### Inherited from

`Omit.rows`

***

### scrollbackLines?

> `readonly` `optional` **scrollbackLines?**: `number`

Defined in: driver/dist/index.d.ts:77

#### Inherited from

`Omit.scrollbackLines`

***

### semanticNegotiationMs?

> `readonly` `optional` **semanticNegotiationMs?**: `number`

Defined in: driver/dist/index.d.ts:76

Maximum time to wait for an optional semantic adapter. Defaults to 2,000
ms for generic auto-detection. When `requiredCapabilities` is non-empty,
the default is the larger of 2,000 ms and the session `ready` timeout.

#### Inherited from

`Omit.semanticNegotiationMs`

***

### shellIntegration?

> `readonly` `optional` **shellIntegration?**: `"external"` \| `"termwright-posix"` \| `"termwright-powershell"`

Defined in: driver/dist/index.d.ts:84

Termwright-managed modes instrument an interactive shell with exact
command markers. Test authors should normally use `terminal.openShell()`.

#### Inherited from

`Omit.shellIntegration`

***

### template?

> `readonly` `optional` **template?**: `string` \| [`SeedTemplate`](../seedtemplate/)

Defined in: [test/src/fixtures.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L67)

A directory to copy in first, so a test can start from a whole project and
change only what it is about. `files` are written over it.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: driver/dist/index.d.ts:68

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

Defined in: driver/dist/index.d.ts:78

#### Inherited from

`Omit.timeouts`

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/fixtures.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L69)

Trace policy for this session, overriding the file's and the project's.
