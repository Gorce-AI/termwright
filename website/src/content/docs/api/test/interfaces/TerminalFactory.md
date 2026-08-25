---
title: "Interface: TerminalFactory"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TerminalFactory

# Interface: TerminalFactory

Defined in: [test/src/fixtures.ts:118](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L118)

Launches terminals that close themselves when the test ends.

## Properties

### logs

> `readonly` **logs**: [`LogCollection`](../logcollection/)

Defined in: [test/src/fixtures.ts:135](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L135)

Everything the programs of this test logged, oldest first.

***

### sessions

> `readonly` **sessions**: readonly [`TerminalHarness`](../terminalharness/)[]

Defined in: [test/src/fixtures.ts:131](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L131)

Sessions launched by this test, in launch order.

***

### tmpdir

> `readonly` **tmpdir**: `string`

Defined in: [test/src/fixtures.ts:133](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L133)

The test's private working directory.

## Methods

### attach()

> **attach**\<`T`\>(`harness`, `options?`): `Promise`\<`T`\>

Defined in: [test/src/fixtures.ts:129](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L129)

Adopts an existing harness for this test.

The fixture collects its logs, publishes it to the Runner, records its
trace, and closes it during teardown. This works with every component
helper that returns the shared `TerminalHarness` contract.

#### Type Parameters

##### T

`T` *extends* [`TerminalHarness`](../terminalharness/)

#### Parameters

##### harness

`T`

##### options?

[`AttachFixtureOptions`](../attachfixtureoptions/)

#### Returns

`Promise`\<`T`\>

***

### failOnLogLevel()

> **failOnLogLevel**(`level`): `void`

Defined in: [test/src/fixtures.ts:142](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L142)

Overrides [TermwrightConfig.failOnLogLevel](../termwrightconfig/#failonloglevel) for this test.

`false` accepts whatever the program logs — the escape hatch for a test
that *expects* an error path to be exercised.

#### Parameters

##### level

`false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

#### Returns

`void`

***

### launch()

> **launch**(`options?`): `Promise`\<[`TerminalHarness`](../terminalharness/)\>

Defined in: [test/src/fixtures.ts:119](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L119)

#### Parameters

##### options?

[`LaunchFixtureOptions`](../launchfixtureoptions/)

#### Returns

`Promise`\<[`TerminalHarness`](../terminalharness/)\>

***

### openShell()

> **openShell**(`options?`): `Promise`\<[`TerminalHarness`](../terminalharness/)\>

Defined in: [test/src/fixtures.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/fixtures.ts#L121)

Opens an interactive shell with exact command boundaries.

#### Parameters

##### options?

[`OpenShellFixtureOptions`](../openshellfixtureoptions/)

#### Returns

`Promise`\<[`TerminalHarness`](../terminalharness/)\>
