---
title: "Interface: TermwrightConfig"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightConfig

# Interface: TermwrightConfig

Defined in: [test/src/config.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L49)

User-facing configuration. Every field has a documented default.

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [test/src/config.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L51)

Viewport width in cells. Default 100.

***

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/config.ts:63](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L63)

Default command for `terminal.launch()` when the test passes none.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/config.ts:65](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L65)

Extra environment for launched programs. Merged after the palette's.

***

### failOnLogLevel?

> `readonly` `optional` **failOnLogLevel?**: `false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/config.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L80)

Fail an otherwise passing test when the program logged a record at this
level or above. Default `'error'`; `false` turns the check off.

This is the negative assertion nobody writes: a test that clicks through a
flow while the program logs `error: failed to save` is not a passing test,
it is a test that did not look.

***

### outputDir?

> `readonly` `optional` **outputDir?**: `string`

Defined in: [test/src/config.ts:59](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L59)

Where traces and the HTML report are written. Default `termwright-report`.

***

### palette?

> `readonly` `optional` **palette?**: [`ColorPalette`](../colorpalette/)

Defined in: [test/src/config.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L69)

Deterministic palette; also decorates cell snapshots with color names.

***

### profiles?

> `readonly` `optional` **profiles?**: `Readonly`\<`Record`\<`string`, `Omit`\<`TermwrightConfig`, `"profiles"`\>\>\>

Defined in: [test/src/config.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L71)

Overrides selected by the `TERMWRIGHT_PROFILE` environment variable.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [test/src/config.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L53)

Viewport height in cells. Default 30.

***

### snapshotDir?

> `readonly` `optional` **snapshotDir?**: `string`

Defined in: [test/src/config.ts:61](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L61)

Snapshot directory, relative to the test file. Default `__snapshots__`.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [test/src/config.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L67)

Character-width and terminal behavior profile used by the emulator.

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TestTimeoutClasses`](../testtimeoutclasses/)

Defined in: [test/src/config.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L55)

Timeout classes forwarded to the driver, plus the `expect` class.

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/config.ts:57](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L57)

Trace collection policy. Default `retain-on-failure`.

***

### updateSnapshots?

> `readonly` `optional` **updateSnapshots?**: [`UpdateSnapshotsMode`](../../type-aliases/updatesnapshotsmode/)

Defined in: [test/src/config.ts:85](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L85)

Snapshot policy. Normally left unset: it is derived per run from
`TERMWRIGHT_UPDATE_SNAPSHOTS` or Vitest's `--update` flag.
