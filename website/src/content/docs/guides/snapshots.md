---
title: Snapshots
description: Choose between terminal cell snapshots and semantic tree snapshots, then update and review them.
---

Termwright supports two snapshot types. Use the one that matches the behavior
you want to protect.

| Need                                                     | Snapshot                  |
| -------------------------------------------------------- | ------------------------- |
| Exact characters, colors, attributes, and cell positions | Cell snapshot             |
| Roles, accessible names, hierarchy, and semantic state   | Semantic snapshot         |
| Both rendering and meaning are important                 | Use both in the same test |

## Match a cell snapshot

```ts
await expect(app).toMatchCellSnapshot();
```

The first accepted run writes a file under the test's snapshot directory.
Review cell snapshot changes when terminal rendering, width, colors, or layout
are intentional product behavior.

Use an inline expectation for a small focused region:

```ts
await expect(app.getByRole('dialog')).toMatchCellSnapshot(`
┌ Permission ┐
│  Approve   │
└────────────┘
`);
```

## Match a semantic snapshot

```ts
await expect(app).toMatchSemanticSnapshot(`
- dialog "Permission" [modal]:
    - button "Approve" [focused]
    - button "Reject" [!focused]
`);
```

Semantic snapshots require a semantic tree. They are useful when a visual
refactor should not change the test but a role, name, hierarchy, or state
change should.

Scope a semantic snapshot to one region:

```ts
await expect(app).toMatchSemanticSnapshot('- button "Approve" [focused]', {
  within: app.getByRole('dialog'),
});
```

## Update snapshots

The embedded Vitest engine's update flag is forwarded by the Termwright host:

```sh
termwright test -- --update
```

For CI or a scripted workflow, set `TERMWRIGHT_UPDATE_SNAPSHOTS` to one of:

| Value     | Behavior                                        |
| --------- | ----------------------------------------------- |
| `all`     | Rewrite every snapshot.                         |
| `changed` | Write missing snapshots and replace mismatches. |
| `missing` | Write only snapshots that do not exist.         |
| `none`    | Never write; missing snapshots fail.            |

## Review a failure

Check whether the behavior changed, then update only the affected snapshot.
The HTML report and Runner replay help distinguish a rendering change from a
semantic change. Avoid accepting a broad snapshot update before reading its
diff.

## Keep snapshots focused

- Snapshot stable product behavior, not timestamps or random IDs.
- Prefer a scoped semantic snapshot when only one dialog or list matters.
- Use explicit assertions for one important value instead of snapshotting a
  large screen to reach it.
- Keep a cell snapshot when spacing, borders, wide characters, or colors are
  part of the contract.
