---
title: OpenTUI
description: What the OpenTUI adapter reads, why the framework is a good fit, and where its API is documented.
---

[OpenTUI](https://github.com/sst/opentui) is a class-A framework in the
[feasibility classes](../): it retains a `Renderable` tree, each node caches its
`screenX` / `screenY`, and it exposes a parent chain, `getChildren()`, lifecycle
hooks and a `layout-changed` event. That is everything an adapter needs, and it
means bounds are trustworthy without the alternate-screen caveat that applies to
[Ink](../ink/).

Roles are supplied as a convention over reconciler props, in the same spirit as
Ink's `aria-role` / `aria-label` — annotate what a test should be able to find,
and leave the rest to the three-level fallback (explicit annotation → widget
type map → `generic`).

The adapter obeys the same rules as every other one:

- **dormant** without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` — no socket,
  no marker, byte-identical output;
- publishes a full snapshot after every committed frame, then writes the signed
  DCS marker once the frame's bytes are out;
- never throws across its boundary: losing the driver disables semantics and
  leaves the application rendering.

:::note[API reference pending]
`@termwright/opentui` is being finalised alongside the umbrella CLI. The
package's own README is the source of truth for its exported functions, and this
page will carry the annotated example once that surface is frozen. Everything
above is fixed by the [protocol](../../reference/protocol/) and does not depend
on the remaining API decisions.
:::

The Zig core's C ABI is the long-term lever here: it is the layer where
positions and a widget identity already exist for every renderer built on
OpenTUI, not just for the TypeScript one.
