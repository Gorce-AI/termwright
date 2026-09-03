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
import { expect, test } from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.js', import.meta.url));

test('renders CJK-wide layout', async ({ terminal }) => {
  const app = await terminal.launch({
    command: [process.execPath, appPath],
    terminalProfile: 'cjk-wide',
  });

  await expect(app).toMatchCellSnapshot();
});
```

## What a profile switches

| Switch                     | What it decides                                                       |
| -------------------------- | --------------------------------------------------------------------- |
| `ambiguousWidth`           | whether East Asian Ambiguous characters take one column or two        |
| `reflowCursorLineOnResize` | whether the cursor's line reflows on resize (wrapped lines always do) |

All profiles use Unicode 15 extended grapheme clusters. Two policies cover the
supported ambiguous-width behaviors:

| Profile    | Answers                                          |
| ---------- | ------------------------------------------------ |
| `default`  | East Asian Ambiguous characters take one column  |
| `cjk-wide` | East Asian Ambiguous characters take two columns |

## Choose a profile

A profile reproduces width and resize policy. It does not emulate a named
terminal as a whole.

That distinction matters when a test fails on a user's machine but not in CI:
the profile tells you which _answers_ your assertions assumed, which is a real
lead. It cannot tell you that a specific terminal is or is not affected.

## Replay and screenshot consistency

A live session, replay, screenshot, and Runner pane count characters with the
same profile. Termwright records the selected profile in the trace and reuses
it during replay.

## Profile differences in Runner

Replay uses the same profile and grapheme model as the live session.
