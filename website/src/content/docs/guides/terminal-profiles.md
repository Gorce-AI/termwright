---
title: Terminal profiles
description: Why a bordered box drifts by one column, what a profile switches, and why these are switches rather than emulations.
---

Terminals disagree about how wide a character is. Not many characters — but
enough that a bordered box lines up in one terminal and drifts by a column in
another. A **terminal profile** is a named set of answers to exactly those
questions, recorded with the session so a replay counts the way the session did.

```ts
const terminal = await launchTerminal({
  command: ['node', 'app.js'],
  terminalProfile: 'iterm2-ambiguous-wide',
});

terminal.capabilities().terminalProfile; // what this session actually used
```

## What a profile switches

| Switch | What it decides |
|---|---|
| `unicodeVersion` | which width tables apply |
| `ambiguousWide` | whether East Asian Ambiguous characters take one column or two |
| `variationSelectors` | whether `❤️` (VS16) is one column or two |
| `reflowCursorLineOnResize` | whether the cursor's line reflows on resize (wrapped lines always do) |

Three profiles ship, because they cover the three answers real terminals give:

| Profile | Answers |
|---|---|
| `default` | Unicode 11, narrow ambiguous, no VS16 promotion — what most terminals do |
| `kitty` | VS16 promotes to an emoji-width cluster |
| `iterm2-ambiguous-wide` | ambiguous characters take two columns, the way iTerm2 answers when configured for CJK |

## Switches, not emulations

Naming one after kitty means *this is how kitty answers*, not *this is kitty*.
A profile reproduces how terminals differ along four specific axes. It does not
emulate any particular terminal, it is not trying to, and picking `kitty` does
not make your test a test of kitty.

That distinction matters when a test fails on a user's machine but not in CI:
the profile tells you which *answers* your assertions assumed, which is a real
lead. It cannot tell you that a specific terminal is or is not affected.

## One factory, four terminals

A live session, a replay of it, a screenshot of that replay and the runner's
pane are four separate terminals. They agree about what is on screen only if
they count characters identically — and one built by hand somewhere else will
not.

`@termwright/vt` exists so there is exactly one place a terminal comes into
being. The bug that produced the package: the driver loaded the Unicode 11 width
tables and the replay did not, so a session measured at Unicode 11 widths while
its own replay measured the same bytes at Unicode 6. Silently, and visible only
when a box drifted by one column. A shared *config* would not have fixed that;
only a shared *factory* makes it impossible to forget.

The profile is recorded in the trace as `meta.terminalProfile`, so an archive
carries the answers it was written under.

## In the runner

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

## Known limitation: grapheme clustering

`unicodeVersion` accepts only `'11'` today. The intended second value was
`'15-graphemes'`, which would make a ZWJ sequence like 👩‍👩‍👧 occupy one cluster
instead of three.

The addon that provides it cannot be loaded here: importing it inside a Vitest
worker never finishes — two versions, both worker pools, even through
`createRequire` — while plain Node imports it in 20 ms. Every package in this
project tests with Vitest, so a profile needing it would hang the test suite of
everyone who imported it. Three profiles that work beat four when the fourth
freezes the room.

This is also why Yoga (Ink's layout engine) and the width tables can disagree
about a ZWJ cluster: see [Limitations](../../reference/limitations/).
