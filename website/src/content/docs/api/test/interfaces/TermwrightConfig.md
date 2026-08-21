---
title: "Interface: TermwrightConfig"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightConfig

# Interface: TermwrightConfig

Defined in: [test/src/config.ts:54](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L54)

User-facing configuration. Every field has a documented default.

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [test/src/config.ts:56](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L56)

Viewport width in cells. Default 100.

***

### command?

> `readonly` `optional` **command?**: readonly `string`[]

Defined in: [test/src/config.ts:68](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L68)

Default command for `terminal.launch()` when the test passes none.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [test/src/config.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L72)

Extra environment for launched programs. Merged after the palette's.

***

### failOnLogLevel?

> `readonly` `optional` **failOnLogLevel?**: `false` \| `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/config.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L87)

Fail an otherwise passing test when the program logged a record at this
level or above. Default `'error'`; `false` turns the check off.

This is the negative assertion nobody writes: a test that clicks through a
flow while the program logs `error: failed to save` is not a passing test,
it is a test that did not look.

***

### outputDir?

> `readonly` `optional` **outputDir?**: `string`

Defined in: [test/src/config.ts:64](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L64)

Where traces and the HTML report are written. Default `termwright-report`.

***

### palette?

> `readonly` `optional` **palette?**: [`ColorPalette`](../colorpalette/)

Defined in: [test/src/config.ts:76](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L76)

Deterministic palette; also decorates cell snapshots with color names.

***

### profiles?

> `readonly` `optional` **profiles?**: `Readonly`\<`Record`\<`string`, `Omit`\<`TermwrightConfig`, `"profiles"`\>\>\>

Defined in: [test/src/config.ts:78](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L78)

Overrides selected by the `TERMWRIGHT_PROFILE` environment variable.

***

### requiredCapabilities?

> `readonly` `optional` **requiredCapabilities?**: readonly (`"focus"` \| `"semantic-tree"` \| `"stable-identity"` \| `"intended-geometry"` \| `"clipped-geometry"` \| `"painted-region"` \| `"pointer-geometry"` \| `"pointer-hit-testing"` \| `"scroll"` \| `"render-order"` \| `"keyboard-input"` \| `"pointer-input"` \| `"paired-revisions"`)[]

Defined in: [test/src/config.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L70)

Capabilities every launched session must negotiate before it is returned.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [test/src/config.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L58)

Viewport height in cells. Default 30.

***

### snapshotDir?

> `readonly` `optional` **snapshotDir?**: `string`

Defined in: [test/src/config.ts:66](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L66)

Snapshot directory, relative to the test file. Default `__snapshots__`.

***

### terminalProfile?

> `readonly` `optional` **terminalProfile?**: `string`

Defined in: [test/src/config.ts:74](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L74)

Character-width and terminal behavior profile used by the emulator.

***

### timeouts?

> `readonly` `optional` **timeouts?**: [`TestTimeoutClasses`](../testtimeoutclasses/)

Defined in: [test/src/config.ts:60](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L60)

Timeout classes forwarded to the driver, plus the `expect` class.

***

### trace?

> `readonly` `optional` **trace?**: [`TraceMode`](../../type-aliases/tracemode/)

Defined in: [test/src/config.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L62)

Trace collection policy. Default `retain-on-failure`.

***

### updateSnapshots?

> `readonly` `optional` **updateSnapshots?**: [`UpdateSnapshotsMode`](../../type-aliases/updatesnapshotsmode/)

Defined in: [test/src/config.ts:92](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L92)

Snapshot policy. Normally left unset: it is derived per run from
`TERMWRIGHT_UPDATE_SNAPSHOTS` or Vitest's `--update` flag.
