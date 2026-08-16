# @termwright/ink

The semantic adapter for [Ink 7](https://github.com/vadimdemedes/ink). It lets a
termwright driver address your terminal UI by role and name — `getByRole('button',
{name: 'Approve'})` — instead of by grepping the screen for coordinates.

**Without a driver it does nothing at all.** No socket, no semantic tree, no
escape sequences, and output that is byte-for-byte identical to plain
`ink.render`. Ship it in production unconditionally; the instrumentation only
wakes up when `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` are present, which
only a driver sets.

## Install

```sh
npm install @termwright/ink
```

Peer dependencies: `ink >= 7.1`, `react >= 19.2`, Node >= 22.

## Three ways to annotate

Pick the lightest one that fits. They compose: an explicit annotation wins over
`aria-*` on the same element, and everything not overridden still contributes.

### 1. `aria-*` props — native Ink, no dependency on us

If your app already annotates itself for Ink's screen-reader support, it is
already addressable. This costs you nothing and works even if termwright is
never installed:

```tsx
<Box aria-role="checkbox" aria-state={{checked}}>
  <Text>Remember me</Text>
</Box>
```

Role and state come through. The accessible name comes from the rendered text —
Ink does not retain `aria-label` on the element, so it cannot reach us.

### 2. `<Semantic>` — declarative, full control

```tsx
import {Semantic} from '@termwright/ink';

<Semantic role="dialog" name="Permission" state={{modal: true}}>
  <Box borderStyle="round" flexDirection="column">
    <Semantic role="button" name="Approve" state={{focused}} testId="approve">
      <Box><Text>Approve</Text></Box>
    </Semantic>
  </Box>
</Semantic>
```

No hook, no ref, no wrapper element: `<Semantic>` annotates the element its
child already renders, so it adds nothing to the layout and nothing to the
output — the test suite asserts byte identity against the same tree without it.
Nesting needs no wiring; a `listitem` inside a `list` is published under it
because that is where it sits.

The child must be an element that accepts a ref, which in Ink means `<Box>`.
Wrapping a bare `<Text>` annotates nothing (it takes no ref); put it in a Box.

### 3. `useSemantic` — imperative, for what JSX cannot express

When the annotation is computed rather than written — a role that depends on
state, or a node whose ref you already hold:

```tsx
const ref = useRef<DOMElement>(null);
useSemantic(ref, {role: expanded ? 'menu' : 'button', name, state: {expanded}});
return <Box ref={ref}>…</Box>;
```

## Mounting

Swap `render` for `semanticRender`, and annotate the elements a test should be
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
already annotated itself for Ink's screen-reader support needs no changes —
except that Ink does not retain `aria-label` on the element, so the accessible
name comes from the rendered text unless you supply one via `useSemantic`.

## What the driver receives

After every committed frame the adapter publishes a snapshot — roles, names,
states, action hints, test ids, and cell bounds — and then writes a private DCS
marker to stdout once that frame's bytes have been flushed. The marker is how
the driver knows which tree belongs to which screen; it is authenticated with
the session token, invisible in the terminal, and never emitted outside an
instrumented run.

## Application logs

A TUI cannot print diagnostics without corrupting its own render, so they go to
a logger where a test can no longer see them. When the driver enables the `logs`
capability, the adapter forwards them: it subscribes to the `termwright:log`
diagnostics channel and pushes each record over the same socket as the semantic
tree, stamped with the revision that was on screen.

Anything can feed it, with no production dependency on a test tool:

```js
import {channel} from 'node:diagnostics_channel';
channel('termwright:log').publish({level: 'error', message: 'payment failed'});
```

`@termwright/logs` adds redaction and ready-made bridges for pino, winston,
consola and OpenTelemetry. `console.error`/`warn`/`log`/`info`/`debug` are
captured too, tagged `logger: 'console'`; pass `semantics: {captureConsole:
false}` if your logger already prints and you would rather not see both.

The driver sets a rate budget, which the adapter enforces locally: over-budget
records are dropped here rather than allowed to compete with the semantic tree
for the frame budget.

`seq` on the wire is assigned by the adapter, in send order, because the channel
is public and two publishers can legitimately pick the same number. Dropped
records still consume one, so a gap is how the driver reports how many were
lost; a publisher's own number is preserved as the `origin.seq` attribute.

## Incremental updates

When the driver asks for `subscribe: 'diffs'`, the adapter sends a tree delta
instead of a full snapshot after each render: whole-node upserts plus removals
that cascade over the previous tree. The first publication is always a full
snapshot, and so is any update whose delta would cost more than half the
snapshot it describes — the cheaper encoding wins. `get-tree` always answers
with a full snapshot.

## Bounds and `alternateScreen`

Ink measures elements inside its *live layout region*, which coincides with the
terminal viewport only when Ink owns the whole screen. The adapter therefore
claims the `absolute-bounds` capability only when rendering interactively in the
alternate screen buffer, and it omits bounds entirely once `<Static>` output
starts shifting that region. **Pass `alternateScreen: true` if your tests assert
on coordinates.**

## API

- `semanticRender(node, options?)` — `ink.render` plus semantics. Accepts every
  Ink render option, plus `semantics: {env?, handshakeTimeoutMs?}`.
- `withSemantics(renderFn)` — wraps a custom Ink-compatible render function.
- `<Semantic role name? state? actions? testId?>` — annotate the element its
  single child renders. Adds no node, no layout and no bytes.
- `useSemantic(ref, meta)` — annotate a `<Box>` imperatively. A no-op outside a
  session.

## Failure behaviour

The adapter never throws across its boundary. A refused connection, a rejected
token, a malformed frame or a driver that disappears mid-session all disable
semantics silently; the application keeps rendering exactly as before.
