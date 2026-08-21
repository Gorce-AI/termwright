# @termwright/probe-charm — implementation notes

Charm is the framework where the audit's conclusions cost the most to
implement, and where guessing from memory would have been most expensive. This
file records why the probe is shaped the way it is.

## Two majors, two module paths, two strategies

Both Bubbles patch sets exist (v1.0.0 and v2.1.1) and are byte-identical in
substance: the five fields the accessors read kept their names across the
major. That is luck, not design — the fields that *were* renamed
(`filepicker.min`/`max` → `minIdx`/`maxIdx`) happen to be ones no accessor
touches — so each major keeps its own set and its own checksums, and both are
compiled in CI rather than assumed to match.


**v2 is not v1 with a suffix.** It lives at `charm.land/bubbletea/v2`; asking
the proxy for `github.com/charmbracelet/bubbletea/v2` fails with *module
declares its path as: charm.land/bubbletea/v2*. A probe matching by module path
that knows only the GitHub form misses every v2 project and reports nothing,
which reads as an application without semantics rather than as a bug. Both
constants are asserted to be non-derivable from each other.

A project requiring both is refused by name. Go permits it — the paths are
unrelated modules — and there is no way to attribute a frame to one of two
event loops.

## Anchor counts are facts, not preferences

v2 has **one** anchor, in `Program.render`, because v2 consolidated v1's three
call sites into that wrapper.

v1 has **three**, in `tea.go`. A single anchor in `standardRenderer.write`
would be cheaper to carry across an upstream bump — but `write` receives a
plain string, so a probe anchored there gets the frame with nothing to read.
The model is only in scope where `View()` is called. Each hunk is reduced to
one line by an injected helper that renders and then observes, because with the
count fixed by the framework, hunk size is the only lever left.

## Bubbles is a separate module, and that changes the design

Patching Bubble Tea buys the frame hook and nothing else. `charm.land/bubbles/v2`
is a different module, so a component's unexported fields are as far from `tea`
as from an external adapter. The probe therefore:

1. reflects over the **user's model** to find components, reading only
   **exported** fields — a probe that reaches into someone's private
   application state to guess at UI cannot justify itself;
2. recognises components by **package path plus type name**, since every
   Bubbles component is called `Model`;
3. reads them through **public getters**, and through the accessors the second
   patch set adds.

### What the Bubbles patch set unlocks

It adds files and edits none, so there is no diff context to drift on a bump,
and the probe finds the accessors by name through reflection — `tea` never
imports `bubbles`, and an application built against unpatched Bubbles reports
less rather than failing to compile.

| Component | Without the patch set | With it |
|---|---|---|
| `spinner` | a glyph; "animating" and "stuck" are indistinguishable | frame index, so the tree shows it advancing |
| `progress` | `Percent()` returns the animation's **target** | the fraction actually drawn |
| `filepicker` | `HighlightedPath()` gives a path, no position | index and entry count |
| `table` | cannot tell "row absent" from "row scrolled out of view" | the rendered window |
| `list` | the status message looks like any other row | the message itself |

The progress case is the sharpest, and the end-to-end test pins it: the spring
approaches its target asymptotically and settles just short, so `Percent()`
reports `0.420` for a bar that never draws `0.420`. An assertion comparing the
drawn value to the target is exactly the mistake the accessor exists to make
impossible — the test asserts a range instead, with the reason written down.

## Secrets

`textinput.Value()` returns the contents whatever the widget draws, so
publishing it puts a password into the semantic tree, the trace archive and the
HTML report. `EchoMode` is checked: a masked field publishes no value and is
marked readonly, so a reader can tell "empty" from "withheld". The test types a
password, waits for the mask to prove the application received it, and asserts
the secret appears nowhere in the whole published tree. Verified by sabotage —
with the guard bypassed, the test fails.

## Geometry, and honest degradation

Neither major reports bounds. By the time the frame reaches the renderer it is
one styled string, and Lip Gloss has destroyed the mapping from fragment to
screen region: `Style.Render` rebuilds the string rune by rune, joins pad with
spaces indistinguishable from content, and truncation discards the tail without
recording that it existed.

v2 has two channels that could restore it — the layer compositor, which already
keeps absolute bounds per identified layer, and per-cell OSC 8 hyperlinks,
which travel with the character through wrapping and truncation. Until one is
wired, the capability set says so: neither patch set claims `bounds`, and the
probe reports component, name and value **without a position** rather than
inventing coordinates.

The hyperlink channel is narrower than the specification suggests, and the
difference is measured rather than assumed. OSC 8 admits
`key=value:key=value`, but `@xterm/headless` parses those parameters and keeps
**only `id`** — impl-driver put four variants through the emulator (b79c62f)
and `frag=btn7` disappears whether it travels beside an `id` or alone. This is
not a field we decline to read; the parameter is absent from the buffer,
because the emulator did not retain it. So a future emission design has exactly
one carrier field: a single opaque string such as `id=twf:btn7`, with a
separator we choose and parse ourselves, not several independent parameters.
The reception side that landed is `CellSnapshot.link?: { uri, id?, truncated? }`
— note `uri`, not `url`, and `truncated` set when the URI exceeded
`maxStringBytes`, since a cut URI is a wrong URI rather than a shorter one.

Cell attribution is not an alternative route: "which component painted this
glyph" is unavailable in all six audited frameworks, so anything of that shape
must stand on paint order plus geometry.

## Annotations

A Charm component is a value: `Update` returns a copy, and the model the
program holds this frame is not the one it held last frame. An address-keyed
registry — the shape tview uses — would key on an address that stops meaning
anything after the first update. So Charm takes the other idiomatic Go route:
the component declares its own semantics.

```go
func (g gauge) TermwrightSemantics() annotate.Semantics {
    return annotate.Semantics{
        Key: "disk", Role: "progressbar", Name: "Disk usage",
        Actions: []protocol.Action{protocol.ActionFocus},
    }
}
```

The probe consults `TermwrightSemantics()` before deciding what to publish. A
custom type that no recognizer knows would otherwise be walked past in silence;
with a declaration it is reported as what its author says it is. A local type
that embeds a recognised Bubbles component gets both — the author's wording
and the native value/state — merged under D2 precedence, so a name from the
annotation never displaces a focus the probe measured.

What a declaration may say is fixed by the struct, not by review: identity and
intent (`Key`, role/name/test id/description/domain, closed actions and key
relationships). There is deliberately no field for bounds, focus, visibility,
value, rendered text or framework state, and a test in `clients/go/annotate`
reflects over the field set and fails if one appears. Physical facts belong to
the probe; an annotation that could restate them could also contradict them.
Unknown roles and actions are dropped rather than guessed.

Provider methods are evaluated once into candidates. A second pass counts
`SemanticKey` values, gives unique keys stable ids, resolves `LabelledBy` and
`DescribedBy`, and refuses ambiguity: duplicate non-empty keys terminate the
semantic session with `duplicate-semantic-key`; no weakened frame escapes.
Relations are bounded by the
negotiated session limit. Primary provenance stays `framework`, with role,
author fields, relationships and key-stabilized ids recorded in `px`.

Because a declaration is computed per frame from the live value, it stays
fresh: the end-to-end test presses `+`, disk usage moves to 82 %, and the
declared name follows the value without any invalidation step.

## Traps

- **`waitForStable()` is the wrong instrument for an animating UI.** The
  spinner fixture never stops redrawing, so waiting for a quiet screen waits
  forever — "the screen never settled for 100 ms". Poll the tree instead. This
  is not a probe limitation: a stability wait asks a question an animation
  cannot answer.

- **The viewport size cannot be invented.** Validation requires positive
  columns and rows; a snapshot published with zeroes is refused whole, and the
  tree stays empty while the handshake looks healthy. The probe skips frames
  until the terminal has reported a size. Zero is "not known yet", not "small".
- **v1 keeps that size on the renderer, v2 on the Program.** Assuming the
  majors are symmetric here cost a compile — the audit says they are not a
  parameter apart, and this is what that looks like.
- **A module cannot be both `use`d and `replace`d.** Go refuses the workspace
  outright. The replace is the one that matters, since a `use` does not satisfy
  a versioned require.

## Not covered yet

- Lip Gloss provenance. Both channels are identified and neither is wired.
- Windows, and any Charm version other than the two pinned here.
