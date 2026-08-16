"""Delta production, checked against composition as its oracle.

Producing a delta and applying one are mirrors: whatever the client emits, the
driver applies. So every test here composes the emitted delta back onto the
tree it was based on and demands the result equal the tree the client meant to
publish. A diff that is merely plausible is not enough — it has to round-trip.
"""

from __future__ import annotations

import pytest

from termwright import DEFAULT_LIMITS, SemanticClient, apply_tree_delta, validate_tree_delta
from termwright.diffing import build_delta, diff_trees

from test_client import SESSION, TOKEN, FakeDriver

BASE = {
    "v": 1,
    "sessionId": "s-1",
    "revision": 1,
    "columns": 80,
    "rows": 24,
    "rootIds": ["root"],
    "nodes": [
        {"id": "root", "role": "region", "name": "main"},
        {"id": "dialog", "parentId": "root", "role": "dialog", "name": "Permission"},
        {"id": "ok", "parentId": "dialog", "role": "button", "name": "Approve"},
        {"id": "no", "parentId": "dialog", "role": "button", "name": "Reject"},
    ],
}


def tree(revision: int, nodes, root_ids=("root",), cursor=None):
    out = {
        "v": 1,
        "sessionId": "s-1",
        "revision": revision,
        "columns": 80,
        "rows": 24,
        "rootIds": list(root_ids),
        "nodes": nodes,
    }
    if cursor is not None:
        out["cursor"] = cursor
    return out


def by_id(snapshot):
    return {node["id"]: node for node in snapshot["nodes"]}


def assert_round_trips(base, wanted):
    """The delta must compose back into exactly the tree it describes."""
    delta = build_delta(base, wanted)
    assert delta is not None, "expected a delta, got a snapshot fallback"

    shape = validate_tree_delta(delta, DEFAULT_LIMITS)
    assert shape.ok, f"the produced delta is malformed: {shape.code} {shape.detail}"

    result = apply_tree_delta(base, delta, DEFAULT_LIMITS)
    assert result.ok, f"composing it back failed: {result.code} {result.detail}"
    assert by_id(result.snapshot) == by_id(wanted), "the delta does not describe the tree"
    assert sorted(result.snapshot["rootIds"]) == sorted(wanted["rootIds"])
    assert result.snapshot.get("cursor") == wanted.get("cursor")
    return delta


# -- the ordinary shapes of change -----------------------------------------


def test_a_changed_node_round_trips():
    wanted = tree(2, [
        {"id": "root", "role": "region", "name": "main"},
        {"id": "dialog", "parentId": "root", "role": "dialog", "name": "Permission"},
        {"id": "ok", "parentId": "dialog", "role": "button", "name": "Approve",
         "state": {"focused": True}},
        {"id": "no", "parentId": "dialog", "role": "button", "name": "Reject"},
    ])
    delta = assert_round_trips(BASE, wanted)
    assert [node["id"] for node in delta["changed"]] == ["ok"], "only the changed node travels"
    assert delta["removed"] == []


def test_an_added_node_round_trips():
    wanted = tree(2, BASE["nodes"] + [
        {"id": "note", "parentId": "dialog", "role": "text", "name": "Note"},
    ])
    delta = assert_round_trips(BASE, wanted)
    assert [node["id"] for node in delta["changed"]] == ["note"]


def test_a_removed_subtree_costs_one_id():
    wanted = tree(2, [{"id": "root", "role": "region", "name": "main"}])
    delta = assert_round_trips(BASE, wanted)
    # The cascade takes the buttons, so only the dialog is named.
    assert delta["removed"] == ["dialog"]
    assert delta["changed"] == []


def test_a_new_root_carries_the_root_list():
    """Without `rootIds` the composed tree would reject the parentless node."""
    wanted = tree(
        2,
        BASE["nodes"] + [{"id": "aside", "role": "region", "name": "Aside"}],
        root_ids=("root", "aside"),
    )
    delta = assert_round_trips(BASE, wanted)
    assert delta["rootIds"] == ["root", "aside"]


def test_an_unchanged_root_list_is_not_sent():
    wanted = tree(2, BASE["nodes"] + [
        {"id": "note", "parentId": "dialog", "role": "text", "name": "Note"},
    ])
    delta = build_delta(BASE, wanted)
    assert "rootIds" not in delta, "the inherited list already matched"


def test_a_moved_cursor_is_sent_and_a_still_one_is_not():
    with_cursor = tree(2, BASE["nodes"], cursor={"row": 1, "column": 1, "visible": True})
    delta = assert_round_trips(BASE, with_cursor)
    assert delta["cursor"] == {"row": 1, "column": 1, "visible": True}

    moved = tree(3, BASE["nodes"], cursor={"row": 1, "column": 1, "visible": True})
    assert "cursor" not in build_delta(with_cursor, moved), "a still cursor was re-sent"


# -- the cases that quietly corrupt a tree ---------------------------------


def test_a_node_surviving_under_a_removed_parent_is_re_sent():
    """The cascade would take it, so it has to come back in `changed`.

    This is the failure that produces a tree the driver believes and the
    screen contradicts: the node is unchanged, so a naive diff omits it, and
    the removal of its old parent quietly deletes it.
    """
    wanted = tree(2, [
        {"id": "root", "role": "region", "name": "main"},
        # `ok` is untouched but its parent `dialog` is gone, so it reparents.
        {"id": "ok", "parentId": "root", "role": "button", "name": "Approve"},
    ])
    delta = assert_round_trips(BASE, wanted)
    assert delta["removed"] == ["dialog"]
    assert [node["id"] for node in delta["changed"]] == ["ok"]


def test_a_cursor_that_disappears_forces_a_whole_tree():
    """A delta can replace a cursor but never remove one."""
    with_cursor = tree(1, BASE["nodes"], cursor={"row": 1, "column": 1, "visible": True})
    without = tree(2, BASE["nodes"])
    assert build_delta(with_cursor, without) is None


def test_a_rewrite_of_most_of_the_tree_falls_back_to_a_snapshot():
    wanted = tree(2, [
        {"id": node["id"], **{k: v for k, v in node.items() if k != "id"}, "name": "renamed"}
        for node in BASE["nodes"]
    ])
    assert build_delta(BASE, wanted) is None, "a near-total rewrite should not be a delta"


def test_diff_of_identical_trees_is_empty():
    changed, removed, root_ids, cursor_changed = diff_trees(BASE, tree(2, BASE["nodes"]))
    assert (changed, removed, root_ids, cursor_changed) == ([], [], None, False)


# -- what actually goes on the wire ----------------------------------------


async def test_a_diffs_subscription_gets_a_snapshot_then_deltas(endpoint):
    driver = FakeDriver(endpoint, subscribe="diffs")
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")
    assert await client.start(timeout=2.0) is True

    from termwright.tree import Rect, SemanticNode, SemanticSnapshot, SemanticState

    def snapshot(focused: bool):
        return SemanticSnapshot(
            sessionId="ignored",
            revision=0,
            columns=80,
            rows=24,
            rootIds=["root"],
            nodes=[
                SemanticNode(id="root", role="region", name="main", bounds=Rect(0, 0, 80, 24)),
                SemanticNode(
                    id="ok",
                    parentId="root",
                    role="button",
                    name="Approve",
                    bounds=Rect(1, 1, 9, 1),
                    state=SemanticState(focused=True) if focused else None,
                ),
            ],
        )

    await client.publish(snapshot(False))
    await client.publish(snapshot(True))
    await driver.wait_for(4)

    kinds = [frame["type"] for frame in driver.received]
    assert kinds[0] == "snapshot", "the first publish has no base to diff against"
    assert "tree-delta" in kinds, f"the second publish sent {kinds}"
    assert client.snapshots_sent == 1 and client.deltas_sent == 1

    delta = next(frame for frame in driver.received if frame["type"] == "tree-delta")
    assert delta["baseRevision"] == 1 and delta["revision"] == 2
    assert [node["id"] for node in delta["changed"]] == ["ok"]

    await client.close()
    await driver.close()


async def test_a_snapshots_subscription_never_sends_a_delta(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")
    assert await client.start(timeout=2.0) is True

    from test_client import sample_snapshot

    await client.publish(sample_snapshot())
    await client.publish(sample_snapshot())
    await driver.wait_for(4)

    assert all(frame["type"] != "tree-delta" for frame in driver.received)
    assert client.deltas_sent == 0

    await client.close()
    await driver.close()
