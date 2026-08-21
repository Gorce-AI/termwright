---
title: "Type Alias: UpdateSnapshotsMode"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / UpdateSnapshotsMode

# Type Alias: UpdateSnapshotsMode

> **UpdateSnapshotsMode** = `"all"` \| `"changed"` \| `"missing"` \| `"none"`

Defined in: [test/src/config.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L25)

Snapshot writing policy.

- `all` — rewrite every snapshot, even matching ones.
- `changed` — write missing snapshots and overwrite mismatching ones.
- `missing` — write snapshots that do not exist yet; mismatches still fail.
- `none` — never write; a missing snapshot fails the test.
