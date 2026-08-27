---
title: Terminal profiles
description: Select the character-width and resize behavior used by a terminal session and its replay.
---

Terminals disagree about how wide a character is. Not many characters — but
enough that a bordered box lines up in one terminal and drifts by a column in
another. A **terminal profile** is a named set of answers to exactly those
questions, recorded with the session so a replay counts the way the session did.

```ts
import { fileURLToPath } from 'node:url';
import { launchTerminal } from '@termwright/driver';

const appPath = fileURLToPath(new URL('../app.js', import.meta.url));

const terminal = await launchTerminal({
  command: [process.execPath, appPath],
  terminalProfile: 'iterm2-ambiguous-wide',
});

terminal.terminalProfile; // what this session actually used
```

## What a profile switches

| Switch                     | What it decides                                                       |
| -------------------------- | --------------------------------------------------------------------- |
| `unicodeVersion`           | which width tables apply                                              |
| `ambiguousWide`            | whether East Asian Ambiguous characters take one column or two        |
| `variationSelectors`       | whether `❤️` (VS16) is one column or two                              |
| `reflowCursorLineOnResize` | whether the cursor's line reflows on resize (wrapped lines always do) |

Three profiles cover the currently supported behaviors:

| Profile                 | Answers                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `default`               | Unicode 11, narrow ambiguous, no VS16 promotion — what most terminals do              |
| `kitty`                 | VS16 promotes to an emoji-width cluster                                               |
| `iterm2-ambiguous-wide` | ambiguous characters take two columns, the way iTerm2 answers when configured for CJK |

## Choose a profile

A profile reproduces four width and resize choices. It does not emulate the
named terminal as a whole. Selecting `kitty` does not turn the run into a kitty
integration test.

That distinction matters when a test fails on a user's machine but not in CI:
the profile tells you which _answers_ your assertions assumed, which is a real
lead. It cannot tell you that a specific terminal is or is not affected.

## Replay and screenshot consistency

A live session, replay, screenshot, and Runner pane must count characters with
the same profile. Termwright records the selected profile in
`meta.terminalProfile` and reuses it when reconstructing evidence.

## Profile differences in Runner

The browser pane is a real xterm.js, but it is not the headless build, and it
cannot reproduce every profile. When an archive or a live session announces a
profile the pane cannot match, the UI says so rather than rendering something
subtly wrong in silence:

```
profile "iterm2-ambiguous-wide" — this view measures with Unicode 11 widths
```

Treat that notice as it reads: the semantics, the timeline and the tree are all
still exact; only the column arithmetic in that one pane may differ from what
the session saw.

## Grapheme clustering limit

`unicodeVersion` accepts only `'11'` today. The intended second value was
`'15-graphemes'`, which would make a ZWJ sequence like 👩‍👩‍👧 occupy one cluster
instead of three.

Unicode 15 grapheme-cluster mode is not currently available in the Vitest
runtime. ZWJ emoji sequences can therefore differ from a terminal or layout
engine that treats the full sequence as one cluster.

This is also why Yoga (Ink's layout engine) and the width tables can disagree
about a ZWJ cluster: see [Limitations](../../reference/limitations/).
