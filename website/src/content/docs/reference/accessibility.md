---
title: Accessibility
description: ARIA in the runner, the AccessKit export, and an honest account of why there is no native bridge in 1.0.
---

termwright models a terminal application's meaning as an ARIA-aligned tree. That
opens two accessibility questions, and they have different answers: the runner
UI *is* accessible, and the semantic tree *can be exported* to a real
accessibility API — but termwright makes no claim to be an assistive-technology
bridge in 1.0, and this page explains exactly why.

## The runner is accessible

The roles in the protocol were chosen ARIA-aligned from the start, which is what
makes the runner's mapping a lookup table rather than a heuristic. Three
decisions shaped it:

- **Attributes go only where ARIA defines them.** `aria-selected` means
  something on `tab` and `row` and nothing on `listitem`, so a selected list
  item gets `aria-current` instead. Emitting an ignored attribute would look
  right in a DOM dump and say nothing to a screen reader.
- **Attributes are removed when they stop applying.** A stale `aria-disabled` on
  a button the application has since enabled is the expensive kind of lie, so
  the pass that applies them also strips the ones that no longer hold.
- **Decorative text is a hidden span, not CSS generated content.** `::before`
  content *is* announced by screen readers, so the role-and-name caption each
  row shows visually is a real `<span aria-hidden="true">`.

The inspector exposes a proper tree pattern — `tree → treeitem[level, expanded]
→ group → treeitem`, with the children group *inside* its item, as the pattern
requires — and arrow-key navigation moves focus and selection together.

### What was verified, and what was not

Verified through Playwright's accessibility snapshot: the tree structure above,
keyboard navigation, and the Semantic view exposing
`dialog "Permission" → button "Approve"`.

**A real screen reader was not run.** There is none in the environment this was
built in. So what is proven is the accessibility tree Chromium computes — not
the announcement a VoiceOver or NVDA user would actually hear. Those are related
but not the same thing, and the difference is exactly where accessibility work
usually goes wrong.

## The AccessKit export

`toAccessKitTreeUpdate` converts a `SemanticSnapshot` into an
[AccessKit](https://accesskit.dev) `TreeUpdate` in its serde JSON shape:

```ts
import {toAccessKitTreeUpdate} from '@termwright/protocol';

const {update, cellBounds} = toAccessKitTreeUpdate(snapshot, {
  toolkitName: 'ink',
  toolkitVersion: '7.1.1',
});
```

It is a pure transformation, and `@termwright/protocol` takes no dependency on
AccessKit — the output is data a bridge could hand to a real platform adapter.
Hence *bridge-ready* rather than *bridged*.

## Why there is no native bridge in 1.0

Two reasons, both structural rather than a matter of effort.

**There is no window to attach to.** AccessKit's platform adapters attach a tree
to a native window: an `NSView` on macOS, an `HWND` on Windows, a toplevel on
AT-SPI. A terminal application has none of those. The emulator owns the window;
the application under test is a child process writing bytes to a pseudo-terminal.
There is nothing for an adapter to attach to, and no path for an assistive
technology to route a request back to us.

**The geometry does not convert.** Our `bounds` are terminal **cells** — row 3,
column 12 — while AccessKit's `Rect` is pixels relative to the window origin.
Converting needs the cell size and window position, which live in the emulator,
not in the process being tested. Guessing a cell size would produce coordinates
that look authoritative and point nowhere, which is worse than having none.

So the export emits `bounds` **only** when the caller passes `cellSize`. That is
the half of the problem solvable correctly without a window, and it refuses to
fake the other half.

## What this means for you

- If you want the runner UI to be usable with a keyboard and a screen reader:
  it is designed for that, with the caveat above about what was verified.
- If you are building a terminal emulator or a bridge and want a real
  accessibility tree out of a TUI: the export is for you, and the missing piece
  is on your side — you own the window and the cell metrics.
- If you want termwright to make your TUI accessible to screen-reader users
  today: it does not, and 1.0 does not claim to. What it does is keep that
  bridge possible by never inventing a role and by staying ARIA-aligned.

The role model was chosen with this in mind. Whether it becomes a real bridge
depends on someone owning the window side of the problem, which is a different
project from a test driver.
