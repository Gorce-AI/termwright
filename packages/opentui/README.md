# @termwright/opentui

The semantic adapter for [OpenTUI](https://github.com/anomalyco/opentui). Call
it once, and your application publishes an addressable accessibility tree
alongside its terminal output — so a test can say `getByRole('button', { name:
'Approve' }).click()` instead of hunting for a string at row 14.

Without a termwright driver in the environment the adapter is **completely
inert**: no socket, no listener, no tree, no marker, and byte-identical output.
That is asserted, not asserted-to: the conformance suite runs the fixture with
and without the adapter compiled in and compares the two streams byte for byte.

## Install

```sh
pnpm add -D @termwright/opentui
```

Node >= 22, ESM only. `@opentui/core` >= 0.5 is a peer dependency — and note
that OpenTUI itself currently needs **Bun** to load its native library
(see [NOTES.md](./NOTES.md)).

## Usage

```ts
import { BoxRenderable, TextRenderable, createCliRenderer } from '@opentui/core';
import { describeRenderable, instrumentRenderer } from '@termwright/opentui';

const renderer = await createCliRenderer({ screenMode: 'alternate-screen' });
instrumentRenderer(renderer);

const approve = new BoxRenderable(renderer, { id: 'approve', width: 11, height: 1 });
approve.add(new TextRenderable(renderer, { content: '[ Approve ]' }));
renderer.root.add(approve);

describeRenderable(approve, { role: 'button', name: 'Approve' });
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
   `InputRenderable`/`TextareaRenderable` → `textbox`, `SelectRenderable` →
   `list`, `TextTableRenderable` → `table`, `ScrollBoxRenderable` → `region`.
   A `BoxRenderable` stays unmapped — a box is a layout primitive, and a border
   is styling, not semantics.

What the adapter derives on its own: `bounds` from `screenX`/`screenY`/`width`/
`height`, `focused` from OpenTUI's own flag, `focus` as an action for anything
`focusable`, `name` from `plainText` or a box `title`, `value` from a widget's
`value`, and `testId` from an author-chosen `id` (never from the generated
`renderable-<n>` ones).

Only interesting nodes are published: annotated ones, ones whose class maps to a
role, focusable ones, and ones carrying text. Layout boxes are skipped and their
children reparent to the nearest published ancestor, so a tree stays connected
however much of it is dropped.

## Coordinates

`bounds` are published only under `screenMode: 'alternate-screen'`, and that is
also the only configuration in which the adapter claims the `absolute-bounds`
capability. In `main-screen` and `split-footer` mode the renderer draws into a
region whose origin the process cannot observe, so coordinates would be
plausible and wrong — the protocol makes `bounds` optional precisely for this,
and locators fall back to text.

## How a frame gets marked

OpenTUI's render loop writes the frame and *then* emits `frame`. The adapter
collects the tree in that handler — while `screenX`/`screenY` still describe the
frame that was just drawn — pushes the snapshot, waits for the output stream to
drain, and writes the DCS render-commit marker. The driver pairs tree and pixels
on that marker. A frame superseded before its snapshot goes out is dropped
rather than mispaired.

## Component testing

`@termwright/opentui/testing` mounts a scene in the current process, over the
same headless terminal an end-to-end test drives:

```ts
import { BoxRenderable, TextRenderable } from '@opentui/core';
import { describeRenderable } from '@termwright/opentui';
import { mountOpenTui } from '@termwright/opentui/testing';

const harness = await mountOpenTui((renderer) => {
  const approve = new BoxRenderable(renderer, { id: 'approve', width: 13, height: 1 });
  approve.add(new TextRenderable(renderer, { content: '[ Approve ]' }));
  approve.onMouseDown = () => { /* … */ };
  renderer.root.add(approve);
  describeRenderable(approve, { role: 'button', name: 'Approve' });
}, { columns: 40, rows: 10 });

await harness.getByRole('button', { name: 'Approve' }).click();
await harness.commit(() => { status.content = 'Approved'; });
await harness.close();
```

The harness is a `TerminalHarness` — the same locators, actions and waits as a
real-pty session — plus `renderer` and `commit(mutate)`. A click is a mouse
report on stdin, not a call into your handler.

**It requires Bun**, because `@opentui/core` loads its native library through
`bun:ffi`. Under Node it fails immediately with an `unsupported-action` error
naming the runtime, rather than deep inside OpenTUI's FFI shim.

The mount lives on a subpath and not on the root entry on purpose: it imports
`@termwright/driver`, which carries a pty binary, and the adapter you ship in
production must not. `@termwright/driver` and `@termwright/ink-testing` are
optional peer dependencies — a production install needs neither.

## Testing this package

```sh
pnpm build && pnpm typecheck && pnpm test
```

`src/conformance.test.ts` runs the shared adapter contract suite from
`@termwright/conformance` against a real OpenTUI application in a real
pseudo-terminal, and `src/mount.test.ts` exercises `mountOpenTui` by spawning
`src/testing/mount-fixture.ts` under Bun. Both skip themselves, loudly, when
`bun` is not on PATH; set `TERMWRIGHT_REQUIRE_CONFORMANCE=1` (as CI does) to
turn those skips into failures.

Implementation decisions and open threads: [`NOTES.md`](./NOTES.md).
