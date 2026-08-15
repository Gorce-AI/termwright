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
    nodes = [SemanticNode(id="root", role="application", name="")]
    nodes.extend(
        SemanticNode(id=f"n{index}", parentId="root", role="text", name=filler)
        for index in range(80)
    )
    snapshot = SemanticSnapshot(
        sessionId="s-1", revision=1, columns=80, rows=24, rootIds=["root"], nodes=nodes
    )
    result = validate_snapshot(snapshot.to_wire(), DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == "bytes"
