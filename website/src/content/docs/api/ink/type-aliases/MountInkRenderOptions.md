---
title: "Type Alias: MountInkRenderOptions"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / MountInkRenderOptions

# Type Alias: MountInkRenderOptions

> **MountInkRenderOptions** = `Pick`\<`RenderOptions`, `"maxFps"` \| `"exitOnCtrlC"` \| `"patchConsole"` \| `"incrementalRendering"` \| `"concurrent"` \| `"isScreenReaderEnabled"`\>

Defined in: ink/src/mount.tsx:34

The Ink render options a mount may override.

The rest are the harness's own and cannot be changed: `stdout` and `stdin`
are the wires to the session, `interactive` and `alternateScreen` establish
the probe's only defensible coordinate premise, and `onRender` belongs to
the injected probe.

`debug` is absent on purpose: it makes Ink append every frame instead of
repainting, which turns the screen model into a transcript and breaks every
coordinate-based locator.
