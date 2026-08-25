"""Snapshot validation conformance: same accepts, same rejects, same codes."""

from __future__ import annotations

from conftest import geometry, load_vectors, node, snapshot

from termwright import (
    DEFAULT_LIMITS,
    Rect,
    SemanticNode,
    SemanticSnapshot,
    SemanticValueObservation,
    framework_evidence,
    validate_snapshot,
)

def test_vector_limits_match_the_ported_defaults():
    assert load_vectors("snapshots")["limits"] == DEFAULT_LIMITS.to_wire()


def test_snapshot_vectors_match_the_reference_validator():
    vectors = load_vectors("snapshots")
    for case in vectors["accept"]:
        result = validate_snapshot(case["snapshot"], DEFAULT_LIMITS)
        assert result.ok, f"valid snapshot {case['name']} rejected: {result.code}: {result.detail}"
    for case in vectors["reject"]:
        result = validate_snapshot(case["snapshot"], DEFAULT_LIMITS)
        assert not result.ok, f"invalid snapshot {case['name']} accepted"
        assert result.code == case["code"], (
            f"snapshot {case['name']} code={result.code!r}, want {case['code']!r}: {result.detail}"
        )


def test_valid_protocol_v2_snapshot_is_accepted():
    value = snapshot(
        nodes=[
            node(id="root", role="dialog", name="Permission", rect=Rect(0, 0, 20, 4)),
            node(id="ok", parentId="root", role="button", name="OK", rect=Rect(1, 1, 4, 1)),
        ],
        root_ids=["root"],
    ).to_wire()
    result = validate_snapshot(value, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"
    assert result.snapshot == value


def test_protocol_v1_snapshot_is_rejected():
    value = snapshot(nodes=[], root_ids=[]).to_wire()
    value["v"] = 1
    result = validate_snapshot(value, DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == "schema"


def test_legacy_node_geometry_is_rejected():
    value = snapshot(nodes=[node(id="root", role="application", name="app")], root_ids=["root"]).to_wire()
    value["nodes"][0]["bounds"] = {"row": 0, "column": 0, "width": 1, "height": 1}
    result = validate_snapshot(value, DEFAULT_LIMITS)
    assert not result.ok
    assert "bounds" in result.detail


def test_snapshots_built_from_the_dataclasses_validate():
    empty = snapshot(nodes=[], root_ids=[])
    value = SemanticSnapshot(
        sessionId="s-1",
        revision=1,
        columns=80,
        rows=24,
        rootIds=["root"],
        nodes=[
            SemanticNode(id="root", role="application", name="app", geometry=geometry()),
            SemanticNode(
                id="ok",
                parentId="root",
                role="button",
                name="OK",
                geometry=geometry(Rect(row=1, column=1, width=4, height=1)),
            ),
        ],
        coordinateSpace=empty.coordinateSpace,
        hitGrid=empty.hitGrid,
    )
    result = validate_snapshot(value.to_wire(), DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"


def test_semantic_value_preserves_confidentiality_and_rejects_raw_strings():
    known = snapshot(
        nodes=[node(
            id="field",
            role="textbox",
            value=SemanticValueObservation(
                status="known",
                value="visible",
                sensitivity="public",
                evidence=framework_evidence("python-test"),
            ),
        )],
        root_ids=["field"],
    ).to_wire()
    assert validate_snapshot(known, DEFAULT_LIMITS).ok

    withheld = snapshot(
        nodes=[node(
            id="secret",
            role="textbox",
            value=SemanticValueObservation(
                status="withheld", reason="sensitive", sensitivity="sensitive"
            ),
        )],
        root_ids=["secret"],
    ).to_wire()
    assert validate_snapshot(withheld, DEFAULT_LIMITS).ok
    assert "value" not in withheld["nodes"][0]["value"]

    known["nodes"][0]["value"] = "legacy plaintext"
    rejected = validate_snapshot(known, DEFAULT_LIMITS)
    assert not rejected.ok
    assert "value" in rejected.detail


def test_deeply_nested_trees_are_rejected_by_depth():
    nodes = [node(id="n0", role="region", name="")]
    for index in range(1, DEFAULT_LIMITS.maxDepth + 1):
        nodes.append(node(id=f"n{index}", parentId=f"n{index - 1}", role="region", name=""))
    value = snapshot(nodes=nodes, root_ids=["n0"])
    result = validate_snapshot(value.to_wire(), DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == "depth"


def test_oversized_snapshots_are_rejected_by_bytes():
    filler = "x" * (DEFAULT_LIMITS.maxStringBytes - 1)
    # Derived from the ceiling rather than hard-coded: this test was written
    # with a fixed 80 nodes against a 1 MiB limit and silently stopped
    # exceeding anything when the limit moved to 2 MiB.
    count = DEFAULT_LIMITS.maxSnapshotBytes // DEFAULT_LIMITS.maxStringBytes + 2
    nodes = [node(id="root", role="application", name="")]
    nodes.extend(
        node(id=f"n{index}", parentId="root", role="text", name=filler)
        for index in range(count)
    )
    value = snapshot(nodes=nodes, root_ids=["root"])
    result = validate_snapshot(value.to_wire(), DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == "bytes"


# -- the barrier against the next missing field -----------------------------


def test_the_node_keys_are_exactly_the_protocols():
    """A field added to the protocol must fail here, not in production.

    Fields have reached the reference and stayed unknown to clients until
    something tripped over a rejected snapshot. The reference now exports its
    key list; this compares against it, so the next one is a red test on the
    day it lands.
    """
    from termwright.validate import _NODE_KEYS

    expected = {
        "id", "parentId", "role", "name", "description", "value", "state",
        "extended", "actions", "inputRecipes", "labelledBy", "describedBy", "textRanges",
        "testId", "frameworkType", "p", "px", "geometry", "scroll", "paintedRegion",
    }
    assert set(_NODE_KEYS) == expected, {
        "missing here": sorted(expected - set(_NODE_KEYS)),
        "unknown to the protocol": sorted(set(_NODE_KEYS) - expected),
    }


def test_the_state_keys_are_exactly_the_protocols():
    from termwright.validate import _STATE_KEYS

    expected = set(load_vectors("constants")["stateKeys"])
    assert set(_STATE_KEYS) == expected, {
        "missing here": sorted(expected - set(_STATE_KEYS)),
        "unknown to the protocol": sorted(set(_STATE_KEYS) - expected),
    }


def test_the_node_dataclass_can_carry_every_field():
    """The validator knowing a field is not the same as being able to send it.

    A client whose validator accepts a field but whose node type cannot hold it
    is still unable to produce it.
    """
    import dataclasses

    from termwright.tree import SemanticNode
    from termwright.validate import _NODE_KEYS

    fields = {field.name for field in dataclasses.fields(SemanticNode)}
    expected = set(_NODE_KEYS)
    assert expected <= fields, sorted(expected - fields)


def test_the_state_dataclass_can_carry_every_field():
    """The same gap as the node type, for state.

    `offscreen` had to be added to three state structs before any client could
    publish it; the key list alone would have said the validators were fine.
    """
    import dataclasses

    from termwright.tree import SemanticState

    fields = {field.name for field in dataclasses.fields(SemanticState)}
    expected = set(load_vectors("constants")["stateKeys"])
    assert expected <= fields, sorted(expected - fields)
