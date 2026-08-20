---
title: Terminal semantics
description: Understand what a semantic tree adds to screen-level terminal testing and which facts remain framework-dependent.
---

A terminal grid contains characters, colors, attributes, and cursor state. It
does not say that a rectangle is a button, a text field has a label, or a list
item is selected.

A Termwright framework integration can publish that additional meaning as a
semantic tree.

## Screen and semantics answer different questions

| Question | Source |
| --- | --- |
| What characters and styles were rendered? | Terminal grid |
| Did the program enable mouse or paste modes? | Terminal emulator |
| Which element is a button named Save? | Semantic tree |
| Which node is focused or selected? | Framework state |
| Is a node clipped by the viewport? | Qualified framework geometry, when available |
| Which node receives a pointer at this cell? | Exact framework hit test, when available |

Use both sources when both rendering and meaning matter.

## Semantics are optional

An uninstrumented program remains testable with screen text, cell snapshots,
keyboard input, paste, resize, process state, traces, and reports. Semantic
locators fail when no tree is available; they do not infer roles from terminal
text.

## Probes and annotations

A probe observes framework state and publishes a tree after a rendered frame.
An annotation can add application intent that the framework does not retain,
such as a domain-specific name or relationship.

Annotations cannot supply physical facts such as current bounds, visibility,
focus, clipping, or pointer ownership. Those facts must come from the framework
observation.

## Revisions and identity

The terminal screen and semantic tree change over time. Assertions poll across
those revisions. Stable semantic identities can be located again after a new
frame; frame-local identities cannot.

Normal tests should use declarative locators instead of storing references.
Tools that retain a reference must respect its identity kind and revision.

## Geometry is not universal

Frameworks preserve different facts. Textual can expose a clipped visible
region and exact pointer recipient. OpenTUI exposes an exact native hit grid but
not a per-node clipped rectangle. Ink has neither clipping nor hit ownership.

Termwright represents unavailable observations as unknown or unsupported. It
does not convert missing geometry into visibility or clickability.

See [Framework integrations](../../adapters/) and
[Geometry and visibility](../../reference/geometry-visibility/).
