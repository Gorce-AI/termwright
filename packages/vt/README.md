# @termwright/vt

The VT core every termwright package shares: one terminal factory, one terminal
profile.

A live session, a replay of that session, a screenshot of that replay and the
runner pane showing it are four terminals. They only agree about what is on the
screen if they count characters the same way — and a terminal built by hand
somewhere else will not. This package exists so there is exactly one place where
a `@xterm/headless` terminal comes into being.

## Install

```sh
pnpm add @termwright/vt
```

## Usage

```ts
import { createTerminal, loadSerializeAddon, TERMINAL_PROFILES } from '@termwright/vt';

const { terminal, profile } = createTerminal({
  columns: 100,
  rows: 30,
  scrollback: 2_000,
  profile: 'iterm2-ambiguous-wide', // an id, a profile object, or nothing
});

const serialize = loadSerializeAddon(terminal);
terminal.write('│ boxes line up only if both ends agree │');

console.log(profile.id);                   // record this with the session
console.log(terminal.unicode.activeVersion); // the same id: ask a terminal what it is
console.log(Object.keys(TERMINAL_PROFILES));
```

## What a profile is

Terminals disagree about a handful of things that decide whether a bordered box
lines up. A profile is a named set of answers to exactly those questions:

| Switch | What it decides |
|---|---|
| `unicodeVersion` | which width tables apply |
| `ambiguousWide` | whether East Asian Ambiguous characters take one column or two |
| `variationSelectors` | whether `❤️` (VS16) is one column or two |
| `reflowCursorLineOnResize` | whether the cursor's line reflows when the terminal resizes (wrapped lines always do) |

Three profiles ship, because they cover the three answers real terminals give:

- **`default`** — Unicode 11, narrow ambiguous, no VS16 promotion. What most
  terminals do, and what the driver did before profiles existed.
- **`kitty`** — VS16 promotes to an emoji-width cluster.
- **`iterm2-ambiguous-wide`** — ambiguous characters take two columns, the way
  iTerm2 answers when configured for CJK.

Naming one after kitty means *this is how kitty answers*, not *this is kitty*.
A profile is a set of switches that reproduces how terminals differ; it is not
an emulation of any particular one, and it is not trying to become one.

## Known limitation: grapheme clustering

`unicodeVersion` accepts only `'11'` today. The intended second value was
`'15-graphemes'`, backed by `@xterm/addon-unicode-graphemes`, which would make a
ZWJ sequence like 👩‍👩‍👧 occupy one cluster instead of three.

That addon cannot be loaded here: importing it inside a vitest worker never
finishes — 0.4.0 and 0.5.0-beta alike, in both the `threads` and `forks` pools,
and even through `createRequire` — while plain Node imports it in 20 ms. Every
package in this repository tests with vitest, so a profile that needed it would
hang the test suite of everyone who imported this package. Shipping three
profiles that work beats shipping four when the fourth freezes the room.

`reflowCursorLineOnResize` is named for exactly what it reaches. xterm.js always
reflows *wrapped* lines; the only choice it offers is the cursor's line, and the
field says so rather than promising reflow control it does not have.

## Why the factory, and not just a shared config

The bug that prompted this package: the driver loaded the Unicode 11 addon and
the replay did not, so a session measured a character at Unicode 11 widths and
its own replay measured the same bytes at Unicode 6 — silently, and only visibly
when a box drifted by one column. A shared *config* would not have fixed that;
only a shared *factory* makes it impossible to forget.

The factory also absorbs one upstream trap: `@xterm/headless` and its addons are
CJS-only despite shipping `.mjs` builds, so they must be imported through their
default export. That workaround now lives in one file instead of four.
