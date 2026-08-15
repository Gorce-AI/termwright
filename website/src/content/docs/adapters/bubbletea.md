---
title: Bubble Tea
description: Why Bubble Tea degrades to generic text mode, what you still get, and the one path to real semantics.
---

Bubble Tea gets an honest page rather than an adapter, because the limitation is
structural and no amount of engineering on our side removes it.

## Why there is no tree to publish

A Bubble Tea `View()` returns a **string**. Lip Gloss composes that string by
joining styled fragments, and a join does not retain what was joined: after
`lipgloss.JoinHorizontal` there is no object that says "a button labelled
Approve occupies columns 14–24 of row 23". The positions exist only as a
consequence of the concatenation.

That places Bubble Tea in **class B** — string composition — in the
[feasibility classes](../). Class A frameworks (Ink, Textual, tview, OpenTUI)
retain a widget tree with positions, which is what an adapter walks. There is
nothing analogous to walk here.

We are not forking Bubble Tea, and we are not shipping an adapter that infers a
tree by parsing the rendered string. Guessed roles are worse than no roles: a
locator that silently matches the wrong cell is a test that lies.

## What you get anyway

A Bubble Tea program is a first-class **generic-mode** target, which is most of
the product:

- a real pseudo-terminal — raw mode, `SIGWINCH`, signals, exit codes;
- the full VT model: text, cells, colours, attributes, cursor, alternate screen,
  mouse-encoding modes, bracketed paste;
- text and regex locators, style predicates (`getByText('FAILED', {fg: 'red'})`),
  occurrence selection, region scoping, scrollback search;
- revision-based waits instead of sleeps;
- cell snapshots, recordings, and the HTML failure report;
- the same session driven by an [agent over MCP](../../guides/mcp/).

```ts
test('quits on q', async ({terminal}) => {
  const app = await terminal.launch({command: ['./my-bubbletea-app']});

  await app.waitForText('Permission required');
  await app.press('Tab');
  await expect(app).toHaveText('[Reject]');

  await app.press('q');
  expect((await app.waitForExit()).code).toBe(0);
});
```

What you do not get is `getByRole`, semantic YAML snapshots, or the semantic
half of the failure diff. Diagnostics say `semanticTree: false` throughout, so
nothing degrades silently.

## The path to real semantics

There is one, and it belongs to the application author rather than to us:
**Lip Gloss v2's Canvas / Layer API**. A program that positions its content
through layers has real coordinates for its parts, and those can be published —
either through explicit annotations or through a Canvas-aware adapter.

If your program is built that way and you want a semantic tree, open an issue:
the protocol and the Go client are already there, and it is the composition
model that has been the blocker.

## Migrating from teatest

`teatest` drives a `Model` in process and asserts on its output; it stays useful
for exactly that. See [Migrating](../../guides/migrating/) for how the two fit
together — the short version is that termwright adds process fidelity, waits and
forensics, not locators, for a string-composed UI.
