---
title: "Interface: MountInkOptions"
editUrl: false
---

[**@termwright/ink-testing**](../../)

***

[@termwright/ink-testing](../../) / MountInkOptions

# Interface: MountInkOptions

Defined in: [ink-testing/src/mount.tsx:45](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L45)

Options for [mountInk](../../functions/mountink/).

## Properties

### columns?

> `readonly` `optional` **columns?**: `number`

Defined in: [ink-testing/src/mount.tsx:47](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L47)

Terminal width in cells. Default 80.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [ink-testing/src/mount.tsx:57](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L57)

Extra variables for the in-process probe session, never written to `process.env`.

***

### envMode?

> `readonly` `optional` **envMode?**: `EnvMode`

Defined in: [ink-testing/src/mount.tsx:71](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L71)

How the session environment is built, as in `launchTerminal`. Default
`'replace'`.

**What this can and cannot do in a mount.** It shapes the environment the
driver computes and hands to the internal probe. It cannot touch what the component reads from
`process.env`, because that object belongs to the test runner and a mount
deliberately never mutates it. `'replace'` therefore isolates the session,
not the process.

Environment isolation of the application itself is a property only a
separate process can have — use `launchInkFixture` for that.

***

### ink?

> `readonly` `optional` **ink?**: [`MountInkRenderOptions`](../../type-aliases/mountinkrenderoptions/)

Defined in: [ink-testing/src/mount.tsx:86](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L86)

Ink render options this mount overrides.

***

### logs?

> `readonly` `optional` **logs?**: readonly `AppLogSource`[]

Defined in: [ink-testing/src/mount.tsx:80](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L80)

Log files to follow for the lifetime of the mount, as in `launchTerminal`.

Entries arrive on the session timeline as `app-log` events, interleaved
with input and renders, which is what makes "the component logged this
*after* that keystroke" answerable. `collectLogs` in `@termwright/test`
reads them straight off the harness.

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [ink-testing/src/mount.tsx:49](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L49)

Terminal height in cells. Default 24.

***

### settleTimeout?

> `readonly` `optional` **settleTimeout?**: `number`

Defined in: [ink-testing/src/mount.tsx:84](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L84)

How long the initial mount and each `rerender` may take to commit.

***

### timeouts?

> `readonly` `optional` **timeouts?**: `TimeoutClasses`

Defined in: [ink-testing/src/mount.tsx:82](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L82)

Driver timeout classes, as in `launchTerminal`.

***

### wrapper?

> `readonly` `optional` **wrapper?**: `ComponentType`\<\{ `children`: `ReactNode`; \}\>

Defined in: [ink-testing/src/mount.tsx:55](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/mount.tsx#L55)

Providers the component needs — a theme, a store, a router. Applied inside
the error boundary, so a wrapper that throws is reported like any other
render failure.
