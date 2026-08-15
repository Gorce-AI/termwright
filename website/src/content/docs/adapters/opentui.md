---
title: OpenTUI
description: instrumentRenderer and describeRenderable, the three annotation levels, and why bounds need alternate-screen mode.
---

[OpenTUI](https://github.com/anomalyco/opentui) is a class-A framework in the
[feasibility classes](../): it retains a `Renderable` tree, each node caches its
`screenX` / `screenY`, and it exposes a parent chain, children, lifecycle hooks
and a frame event. That is everything an adapter needs.

```sh
npm install --save-dev @termwright/opentui
```

Node >= 22, ESM only. `@opentui/core` >= 0.5 is a peer dependency — and note
that OpenTUI itself currently needs **Bun** to load its native library.

Without a driver in the environment the adapter is **completely inert**: no
socket, no listener, no tree, no marker, byte-identical output. That is
asserted, not claimed: the conformance suite runs the fixture with and without
the adapter compiled in and compares the two streams byte for byte.

## Usage

```ts
import {BoxRenderable, TextRenderable, createCliRenderer} from '@opentui/core';
import {describeRenderable, instrumentRenderer} from '@termwright/opentui';

const renderer = await createCliRenderer({screenMode: 'alternate-screen'});
instrumentRenderer(renderer);

const approve = new BoxRenderable(renderer, {id: 'approve', width: 11, height: 1});
approve.add(new TextRenderable(renderer, {content: '[ Approve ]'}));
renderer.root.add(approve);

describeRenderable(approve, {role: 'button', name: 'Approve'});
```

Call `instrumentRenderer` right after creating the renderer and before building
the tree. Ship both calls unconditionally — in an uninstrumented run
`describeRenderable` is a no-op that registers nothing and retains nothing.

## Annotating

Three levels, in precedence order:

1. **`describeRenderable(node, meta)`** — role, name, description, value, state,
   actions, testId. All optional; anything you leave out is derived.
2. **Convention properties on the renderable** — `role`, `semanticName`,
   `ariaLabel`, `testId`. Assign them *after* construction: OpenTUI's
   `Renderable` constructor drops options it does not recognise, so they cannot
   be passed as props (verified against 0.5.3).
3. **The widget class**, mapped conservatively: `TextRenderable` → `text`,
   `InputRenderable` / `TextareaRenderable` → `textbox`, `SelectRenderable` →
   `list`, `TextTableRenderable` → `table`, `ScrollBoxRenderable` → `region`.
   A `BoxRenderable` stays unmapped — a box is a layout primitive, and a border
   is styling, not semantics.

The adapter derives the rest on its own: `bounds` from
`screenX` / `screenY` / `width` / `height`, `focused` from OpenTUI's own flag,
`focus` as an action for anything focusable, `name` from `plainText` or a box
title, `value` from a widget's value, and `testId` from an author-chosen `id`
(never from a generated `renderable-<n>`).

Only interesting nodes are published: annotated ones, ones whose class maps to a
role, focusable ones, and ones carrying text. Layout boxes are skipped and their
children reparent to the nearest published ancestor, so the tree stays connected
however much of it is dropped.

## Coordinates need alternate-screen mode

`bounds` are published only under `screenMode: 'alternate-screen'`, and that is
also the only configuration in which the adapter claims the `absolute-bounds`
capability.

In `main-screen` and `split-footer` mode the renderer draws into a region whose
origin the process cannot observe, so coordinates would be plausible and wrong.
The protocol makes [`bounds` optional](../../reference/protocol/) precisely for
this case, and locators fall back to text.

## How a frame gets marked

OpenTUI's render loop writes the frame and *then* emits `frame`. The adapter
collects the tree in that handler — while `screenX` / `screenY` still describe
the frame that was just drawn — pushes the snapshot, waits for the output stream
to drain, and writes the DCS render-commit marker. The driver pairs tree and
pixels on that marker, and a frame superseded before its snapshot goes out is
dropped rather than mispaired.

## Also exported

`readAdapterEnv`, `asSemanticRole`, `defaultActionsFor`, `mapRenderableClass`
and `canPublishAbsoluteBounds` are public for anyone building on the same
machinery — a different OpenTUI host, or a renderer that wants the role map
without the instrumentation.
