# @termwright/probe-charm — implementation notes

Charm is the framework where the audit's conclusions cost the most to
implement, and where guessing from memory would have been most expensive. This
file records why the probe is shaped the way it is.

## Two majors, two module paths, two strategies

Both Bubbles patch sets exist (v1.0.0 and v2.1.1) and are byte-identical in
substance: the five fields the accessors read kept their names across the
major. That is luck, not design — the fields that _were_ renamed
(`filepicker.min`/`max` → `minIdx`/`maxIdx`) happen to be ones no accessor
touches — so each major keeps its own set and its own checksums, and both are
compiled in CI rather than assumed to match.

**v2 is not v1 with a suffix.** It lives at `charm.land/bubbletea/v2`; asking
the proxy for `github.com/charmbracelet/bubbletea/v2` fails with _module
declares its path as: charm.land/bubbletea/v2_. A probe matching by module path
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

1. reflects over the **user's model** to find components; exported fields are
   walked normally, while private, scalar, nil and depth-limited subtrees are
   retained as `opaque-container` nodes with the named
   `custom-container-enumeration` degradation rather than guessed or omitted;
2. recognises components by **package path plus type name**, since every
   Bubbles component is called `Model`;
3. reads them through **public getters**, and through the accessors the second
   patch set adds.

### What the Bubbles patch set unlocks

It adds compiler units and edits no upstream byte, so there is no diff context
to drift on a bump. The launcher supplies those units through `-toolexec`, and
the probe finds their accessors by name through reflection — `tea` never imports
`bubbles`. The owned units are selected by module line and preflight-compiled
against the resolved candidate; private-field drift is therefore a loud
capability failure rather than a version guess. The runtime also refuses a
recognised private-state component when the caller omitted the returned
`goArgs`, so it never silently falls back to public-getter-only facts.

| Component    | Without the patch set                                    | With it                                     |
| ------------ | -------------------------------------------------------- | ------------------------------------------- |
| `spinner`    | a glyph; "animating" and "stuck" are indistinguishable   | frame index, so the tree shows it advancing |
| `progress`   | `Percent()` returns the animation's **target**           | the fraction actually drawn                 |
| `filepicker` | `HighlightedPath()` gives a path, no position            | index and entry count                       |
| `table`      | cannot tell "row absent" from "row scrolled out of view" | the rendered window                         |
| `list`       | the status message looks like any other row              | the message itself                          |

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

v2's layer compositor keeps absolute bounds per identified layer, but its index
is owned by an internal compositor instance that is not reachable from Bubble
Tea's flattened public `View.Content` boundary. The verification spike found no
stable handle from which an add-only unit could pull that map at publication
time. Until such an in-process seam exists, neither major claims bounds: the
probe reports component, name and value **without a position** rather than
inventing coordinates.

OSC 8 is deliberately not a fallback. Hyperlinks are application-owned visual
state, collide with real links and travel through a host-dependent terminal
path. Semantic provenance travels over the authenticated probe socket; the
terminal's `CellSnapshot.link` remains visual evidence only.

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
custom type that no recognizer knows is still retained structurally; with a
declaration it gains the role and name its author intends. Annotation is never
required for structure. A local type
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

- **`waitForQuiet()` is the wrong instrument for an animating UI.** The
  spinner fixture never stops redrawing, so waiting for a quiet screen waits
  forever — "the screen never settled for 100 ms". Observe committed checkpoint
  changes instead of polling wall time. This is not a probe limitation: a
  stability wait asks a question an animation cannot answer.

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

## Remaining scope

- Lip Gloss provenance. Both channels are identified and neither is wired.
- Bubble Tea v1.3.10 and v2.0.8/v2.0.9 are the exact certified T3 profiles.
  Other v1/v2 versions fail closed until certified. Future v3 module streams
  may be discovered and monitored, but the current certifier does not
  automatically admit them.
- Windows is covered by the native marker path and the platform PTY matrix; it
  is not an untested fallback.
