---
title: Ink
description: The reference adapter — semanticRender, useSemantic, bounds and alternateScreen, and what it does when things go wrong.
---

`@termwright/ink` is the adapter for [Ink 7](https://github.com/vadimdemedes/ink)
and the reference implementation of the protocol.

```sh
npm install @termwright/ink
```

Peer dependencies: `ink >= 7.1`, `react >= 19.2`, Node >= 22.

**Without a driver it does nothing at all.** No socket, no semantic tree, no
escape sequences, and output byte-for-byte identical to plain `ink.render`. Ship
it unconditionally; the instrumentation wakes up only when `TERMWRIGHT_ENDPOINT`
and `TERMWRIGHT_TOKEN` are present, which only a driver sets.

## Annotating an app

Swap `render` for `semanticRender`, then annotate the elements a test should be
able to find:

```tsx
import {useRef, useState} from 'react';
import {Box, Text, useInput, type DOMElement} from 'ink';
import {semanticRender, useSemantic} from '@termwright/ink';

function Approve({onDone}: {onDone: () => void}) {
  const ref = useRef<DOMElement>(null);
  const [focused, setFocused] = useState(true);

  useSemantic(ref, {
    role: 'button',
    name: 'Approve',
    state: {focused},
    testId: 'approve-button',
  });

  useInput((_input, key) => {
    if (key.return) onDone();
    setFocused(true);
  });

  return (
    <Box ref={ref} borderStyle="round">
      <Text>Approve</Text>
    </Box>
  );
}

const app = semanticRender(<Approve onDone={() => app.unmount()} />, {
  alternateScreen: true,
});
await app.waitUntilExit();
```

`<Box aria-role="button" aria-label="Approve">` is picked up too, so an app that
already annotated itself for Ink's screen-reader support needs no changes. One
caveat: Ink does not retain `aria-label` on the element, so the accessible name
comes from the rendered text unless you supply one via `useSemantic`.

## API

- `semanticRender(node, options?)` — `ink.render` plus semantics. Accepts every
  Ink render option, plus `semantics: {env?, handshakeTimeoutMs?}`.
- `withSemantics(renderFn)` — wraps a custom Ink-compatible render function.
- `useSemantic(ref, meta)` — annotate a `<Box>`. A no-op outside a session.

## Bounds and `alternateScreen`

Ink measures elements inside its *live layout region*, which coincides with the
terminal viewport only when Ink owns the whole screen. The adapter therefore
claims the `absolute-bounds` capability only when rendering interactively in the
alternate screen buffer, and it omits bounds entirely once `<Static>` output
starts shifting that region.

:::caution
**Pass `alternateScreen: true` if your tests assert on coordinates** — or click.
A click is hit-tested against bounds; without them the driver has no cell to
send a mouse report to.
:::

A snapshot carrying no bounds at all is a valid snapshot, not a fault. Locators
by role and name keep working; only geometry-dependent operations degrade.

## What the driver receives

After every committed frame the adapter publishes a snapshot — roles, names,
states, action hints, test ids, cell bounds — and then writes a private DCS
marker to stdout once that frame's bytes have been flushed. The marker is how
the driver knows which tree belongs to which screen: it is authenticated with
the session token, invisible in the terminal, and never emitted outside an
instrumented run.

The ordering matters and is part of the contract: snapshot, then
`revision-commit`, then the marker after the frame's last byte.

## Failure behaviour

The adapter never throws across its boundary. A refused connection, a rejected
token, a malformed frame or a driver that disappears mid-session all disable
semantics silently; the application keeps rendering exactly as before. An app is
never broken by the thing that was supposed to observe it.

## Known gaps

- **No `cursor` in snapshots.** Ink has `useCursor` / `setCursorPosition` but
  exposes no way to read the committed cursor position from outside a component,
  so the protocol field stays absent until it does.
- **`text-ranges` and `tree-diffs` capabilities are not claimed.** Both are
  additive in 1.x and neither is needed by the current driver.
- **Windows is untested.** Named pipes are handled by `node:net` transparently,
  but nothing in this package has been exercised on a ConPTY host.

## Component testing

For mounting a component instead of launching a process, see
[Component testing](../../guides/component-testing/) — `mountInk` uses this same
adapter, which is why a test moves between the two modes by changing its first
line.
