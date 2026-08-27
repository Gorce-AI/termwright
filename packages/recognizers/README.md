# @termwright/recognizers

The rules that turn observed facts into meaning.

A probe reports what a framework exposed — classes, coordinates, flags. This
package decides what those facts _are_: a role, a name, a state. Keeping the two
apart is what lets six frameworks disagree about what is knowable without that
disagreement leaking into the semantic tree.

Everything here is a pure function over Probe IR, so the rules can be tested
without a process, a framework or a socket, and the same rules apply to every
framework instead of being reinvented once per adapter.

## Install

```sh
npm install @termwright/recognizers
```

Depends on `@termwright/protocol` and nothing else.

## Usage

```ts
import { recognize } from '@termwright/recognizers';

const snapshot = recognize(probeFrame, {
  sessionId,
  revision,
  columns: 80,
  rows: 24,
  framework: 'opentui',
  paintOrderKnown: true,
});
```

## The rules

**Role** resolves in the normative order: an author annotation, then the
framework's widget map, then `generic`. An annotation naming a role outside the
closed set falls through to the map rather than becoming an invented role.

**An unrecognised widget is never dropped.** It becomes `generic` and keeps its
`frameworkType`, bounds, text and children, so a test can still find it by what
the framework called it.

**Names come from content only for the roles that take them that way** —
`button`, `listitem`, `menuitem`, `tab`, `checkbox`, `radio`, `cell`, `row`,
`heading`, plus `text` for its own string. A container keeps an empty name
unless annotated: naming it from its content is what makes
`getByRole('region', {name: 'Approve'})` match the dialog _containing_ the
button.

**Physical facts stay the framework's.** An author may name a thing; an author
may not declare where it is on screen, whether it has focus, or whether it is
visible. Provenance records this: one source per node in `p`, exceptions in
`px`.

## Deviations

**OpenTUI's map is short on purpose.** `BoxRenderable`, `ScrollBoxRenderable`,
`TabSelectRenderable` and `SliderRenderable` resolve to `generic`. A tab strip
is not a `tab`, and a role that reads right while matching the wrong node is
worse than an honest `generic` — which, with `frameworkType`, is still findable.

**An orphan is reparented, not dropped.** If a node's parent did not survive the
frame — a truncated walk, a removal mid-observation — the node attaches to the
root. A dangling `parentId` is refused by snapshot validation outright, and
losing the subtree would be the worse of the two failures.
