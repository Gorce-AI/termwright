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

## Deviations

The protocol's adapter conventions are normative; where Ink does not expose what
a rule needs, the difference is declared here rather than left for you to
discover. Each entry says what the rule asks, what this adapter does, and why.

**Rule 2 — `text` nodes are named from their own string.** The normative
name-from-content set is `button`, `listitem`, `menuitem`, `tab`, `checkbox`,
`radio`, `cell`, `row`, `heading`, and this adapter honours it: containers get
an empty name unless you annotate one. `text` is treated as a tenth case,
because an `ink-text` element's string is its *own* content — naming source 2,
"the widget's own label" — not a descendant widget's text. Without it
`getByText` would have nothing to match.

**Rule 2 — `aria-label` cannot be read.** Ink turns `aria-label` into a text
child only when a screen reader is active and drops it otherwise; it is not
retained on the element. Names therefore come from an annotation or from
content, never from Ink's own label prop.

**Rule 3 — no native identifier.** Ink elements have no id, so `testId` comes
from an annotation only. Nothing is filtered, because nothing is generated.

**Rule 4 — `focused` needs the focusable named.** Ink publishes *which*
focusable is active (`useFocusManager().activeId`) but never which element owns
it, and `useFocus` cannot be called by the adapter without registering a new
focusable and changing your Tab order. Pass the same id you gave `useFocus` and
the adapter derives the state from Ink's own flag:

```tsx
useFocus({id: 'approve'});
<Semantic role="button" focusId="approve"><Box>…</Box></Semantic>
```

Without `focusId` (or an explicit `state={{focused}}`), `focused` is omitted
rather than guessed.

**Rule 4 — hidden nodes are dropped, not published as `hidden: true`.** A
subtree under `display: none` is excluded from Yoga layout and from the
snapshot. Both behaviours are defensible; this one means a test cannot assert
that something exists but is hidden.

**Rule 5 — `value` comes from annotations only.** Ink has no value-bearing
widget: text entry is a third-party component built from `<Text>`, so there is
no native property to read. An annotated `value` is published verbatim,
**including the empty string** — `value: ''` means an empty field, absent means
not a value-bearing widget.

**Bounds are omitted rather than approximated.** See *Bounds and
`alternateScreen`* above: outside the alternate screen, or once `<Static>`
shifts the live region, the adapter publishes no `bounds` instead of publishing
coordinates it cannot vouch for.

## Failure behaviour

The adapter never throws across its boundary. A refused connection, a rejected
token, a malformed frame or a driver that disappears mid-session all disable
semantics silently; the application keeps rendering exactly as before.
