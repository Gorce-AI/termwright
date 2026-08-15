---
title: Adapters overview
description: Which frameworks can publish a semantic tree, which cannot, and what you get in each case.
---

An adapter is the piece that lets an application publish what it *means*, not
just what it paints. It is small, it ships in production, and outside a test run
it does nothing at all: without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in
the environment a conforming adapter opens no socket, writes no marker, and
renders byte-for-byte identical output. That rule is called the **dormant rule**
and the [conformance suite](../reference/protocol/) enforces it.

## Feasibility classes

Whether a framework *can* publish a useful tree is a property of the framework,
not of our effort, and it is worth knowing before you plan a migration:

| Class | Shape | Result | Examples |
|---|---|---|---|
| **A** | retains a widget tree with positions | full semantic tree with bounds | Ink, OpenTUI, Textual, tview, prompt_toolkit |
| **B** | composes strings | role+name only where the author annotates; otherwise generic text mode | Bubble Tea + Lip Gloss joins |
| **C** | immediate mode — positions exist only during the draw call | instrumented mode: the author wraps their draws | Ratatui, cursive, urwid |

Class A adapters certify as `full-semantic`. Class C can reach the same tree
through a one-line wrapper by the application author. Class B degrades to
generic text mode, and we say so rather than pretending otherwise.

## Status

| Adapter | Package | Status |
|---|---|---|
| [Ink](ink/) | `@termwright/ink` | full, and the reference implementation |
| [OpenTUI](opentui/) | `@termwright/opentui` | 1.0 |
| [Textual](textual/) | `termwright` (PyPI) | 1.0 |
| [tview](tview/) | `github.com/gorce-ai/termwright/clients/go` | 1.0 |
| [Bubble Tea](bubbletea/) | — | honest degradation; read before adopting |
| Ratatui | `termwright-protocol` (crate) | protocol client only; instrumented adapter in 1.x |

Explicitly not planned: blessed (dead), termui (stagnant).

## What you get without one

A great deal, and it is worth saying plainly: text and regex locators, cell and
colour assertions, style predicates, scrollback search, mouse, paste, resize,
signals, recordings and the failure report. Generic matches resolve to
rectangles, never to invented roles, and every diagnostic says
`semanticTree: false` so a test never silently degrades into asserting on
nothing.

The semantic tree is an upgrade, not a requirement.

## Writing your own

The protocol is language-neutral and the contract suite runs against any adapter
in any language, over a subprocess. See
[Writing an adapter](writing-an-adapter/).
