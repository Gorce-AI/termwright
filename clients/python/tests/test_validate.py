"""Snapshot validation conformance: same accepts, same rejects, same codes."""

from __future__ import annotations

import pytest
from conftest import load_vectors

from termwright import DEFAULT_LIMITS, Rect, SemanticNode, SemanticSnapshot, validate_snapshot

VECTORS = load_vectors("snapshots")


def test_vector_limits_match_the_ported_defaults():
    assert VECTORS["limits"] == DEFAULT_LIMITS.to_wire()


@pytest.mark.parametrize("case", VECTORS["accept"], ids=lambda case: case["name"])
def test_valid_snapshots_are_accepted(case):
    result = validate_snapshot(case["snapshot"], DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"
    assert result.snapshot == case["snapshot"]


@pytest.mark.parametrize("case", VECTORS["reject"], ids=lambda case: case["name"])
def test_invalid_snapshots_are_rejected_with_the_same_code(case):
    result = validate_snapshot(case["snapshot"], DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == case["code"], result.detail


def test_snapshots_built_from_the_dataclasses_validate():
    snapshot = SemanticSnapshot(
        sessionId="s-1",
        revision=1,
        columns=80,
        rows=24,
        rootIds=["root"],
        nodes=[
            SemanticNode(id="root", role="application", name="app"),
            SemanticNode(
                id="ok",
                parentId="root",
                role="button",
                name="OK",
                bounds=Rect(row=1, column=1, width=4, height=1),
            ),
        ],
    )
    result = validate_snapshot(snapshot.to_wire(), DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"


def test_deeply_nested_trees_are_rejected_by_depth():
    nodes = [SemanticNode(id="n0", role="region", name="")]
    for index in range(1, DEFAULT_LIMITS.maxDepth + 1):
        nodes.append(SemanticNode(id=f"n{index}", parentId=f"n{index - 1}", role="region", name=""))
    snapshot = SemanticSnapshot(
        sessionId="s-1", revision=1, columns=80, rows=24, rootIds=["n0"], nodes=nodes
    )
    result = validate_snapshot(snapshot.to_wire(), DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == "depth"


def test_oversized_snapshots_are_rejected_by_bytes():
    filler = "x" * (DEFAULT_LIMITS.maxStringBytes - 1)
    # Derived from the ceiling rather than hard-coded: this test was written
    # with a fixed 80 nodes against a 1 MiB limit and silently stopped
    # exceeding anything when the limit moved to 2 MiB.
    count = DEFAULT_LIMITS.maxSnapshotBytes // DEFAULT_LIMITS.maxStringBytes + 2
    nodes = [SemanticNode(id="root", role="application", name="")]
    nodes.extend(
        SemanticNode(id=f"n{index}", parentId="root", role="text", name=filler)
        for index in range(count)
    )
    snapshot = SemanticSnapshot(
        sessionId="s-1", revision=1, columns=80, rows=24, rootIds=["root"], nodes=nodes
    )
    result = validate_snapshot(snapshot.to_wire(), DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == "bytes"


# -- the barrier against the next missing field -----------------------------


def test_the_node_keys_are_exactly_the_protocols():
    """A field added to the protocol must fail here, not in production.

    frameworkType, occlusion, p and px each reached the reference and stayed
    unknown to this client until something tripped over a rejected snapshot.
    The reference now exports its key list; this compares against it, so the
    next one is a red test on the day it lands.
    """
    from termwright.validate import _NODE_KEYS

    expected = set(load_vectors("constants")["nodeKeys"])
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

    A client whose validator accepts `occlusion` but whose node type cannot
    hold one is still unable to produce it — which was exactly the state this
    client was in.
    """
    import dataclasses

    from termwright.tree import SemanticNode

    fields = {field.name for field in dataclasses.fields(SemanticNode)}
    expected = set(load_vectors("constants")["nodeKeys"])
    assert expected <= fields, sorted(expected - fields)
