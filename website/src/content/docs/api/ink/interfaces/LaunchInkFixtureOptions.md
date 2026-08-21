---
title: "Interface: LaunchInkFixtureOptions"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / LaunchInkFixtureOptions

# Interface: LaunchInkFixtureOptions

Defined in: ink/src/fixture.ts:28

Options for [launchInkFixture](../../functions/launchinkfixture/).

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: ink/src/fixture.ts:42

Terminal width in cells. Default 80.

***

### component

> `readonly` **component**: `string` \| `URL`

Defined in: ink/src/fixture.ts:36

The module holding the component: an absolute path or a `file:` URL.

It is imported by the fixture process, so it must be something Node can
load directly — `.js`/`.mjs`, or `.ts` if the fixture runs under a loader
passed in [LaunchInkFixtureOptions.nodeArgs](#nodeargs).

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: ink/src/fixture.ts:46

Working directory of the fixture process.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: ink/src/fixture.ts:48

Extra environment variables for the fixture process.

***

### envMode?

> `readonly` `optional` **envMode?**: `EnvMode`

Defined in: ink/src/fixture.ts:59

How the fixture's environment is built, as in `launchTerminal`. Default
`'replace'`: the process starts from a documented allowlist plus
[LaunchInkFixtureOptions.env](#env), so a variable on a developer's laptop
cannot change what CI sees.

Unlike a mount, this is real isolation — the fixture is a separate process
and its `process.env` is exactly what the driver built. Pass `'inherit'`
when the component genuinely needs the runner's environment.

***

### exportName?

> `readonly` `optional` **exportName?**: `string`

Defined in: ink/src/fixture.ts:38

Export to render. Default `default`.

***

### logs?

> `readonly` `optional` **logs?**: readonly `AppLogSource`[]

Defined in: ink/src/fixture.ts:65

Log files to follow for the lifetime of the fixture, as in
`launchTerminal`. Entries arrive on the session timeline as `app-log`
events; `collectLogs` in `@termwright/test` reads them off the harness.

***

### nodeArgs?

> `readonly` `optional` **nodeArgs?**: readonly `string`[]

Defined in: ink/src/fixture.ts:67

Arguments inserted before the runner, e.g. `['--import', 'tsx']`.

***

### props?

> `readonly` `optional` **props?**: [`JsonProps`](../../type-aliases/jsonprops/)

Defined in: ink/src/fixture.ts:40

Props for the component, transferred as bounded JSON. Never functions.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: ink/src/fixture.ts:44

Terminal height in cells. Default 24.

***

### settleTimeout?

> `readonly` `optional` **settleTimeout?**: `number`

Defined in: ink/src/fixture.ts:71

How long the fixture may take to commit its first frame.

***

### timeouts?

> `readonly` `optional` **timeouts?**: `TimeoutClasses`

Defined in: ink/src/fixture.ts:69

Driver timeout classes, as in `launchTerminal`.
