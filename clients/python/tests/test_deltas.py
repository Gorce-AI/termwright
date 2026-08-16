"""Delta composition against the shared `delta + base → result` vectors."""

from __future__ import annotations

import pytest
from conftest import load_vectors

from termwright import DEFAULT_LIMITS, ProtocolLimits, apply_tree_delta, validate_tree_delta

VECTORS = load_vectors("deltas")


def limits_for(case) -> ProtocolLimits:
    """DEFAULT_LIMITS merged with the case's override, as the vectors define."""
    if "limitsOverride" not in case:
        return DEFAULT_LIMITS
    return ProtocolLimits(**{**DEFAULT_LIMITS.to_wire(), **case["limitsOverride"]})


def by_id(snapshot):
    """Nodes keyed by id.

    The order of `nodes` is not normative — the reference composes through an
    insertion-ordered map, a client backed by a hash map reports another order,
    and both are correct. Comparing as a set is what the contract asks for.
    """
    return {node["id"]: node for node in snapshot["nodes"]}


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda case: case["name"])
def test_composition_matches_the_reference(case):
    limits = limits_for(case)

    # Every fixture's delta is shape-valid; composition is what is under test.
    shape = validate_tree_delta(case["delta"], limits)
    assert shape.ok, f"fixture delta is malformed: {shape.code} {shape.detail}"

    result = apply_tree_delta(case["base"], case["delta"], limits)
    expected = case["expect"]

    if not expected["ok"]:
        assert not result.ok, f"a composition that should have failed produced a tree"
        assert result.code == expected["code"], result.detail
        return

    assert result.ok, f"{result.code}: {result.detail}"
    composed = result.snapshot
    want = expected["snapshot"]

    assert by_id(composed) == by_id(want), "composed nodes differ"
    assert sorted(composed["rootIds"]) == sorted(want["rootIds"])
    assert composed["revision"] == want["revision"]
    assert composed.get("cursor") == want.get("cursor")
    # The viewport is inherited: a delta cannot change it.
    assert (composed["columns"], composed["rows"]) == (want["columns"], want["rows"])
    assert composed["sessionId"] == want["sessionId"]


def test_every_composition_rule_is_covered():
    """The vectors are only useful if each rule actually has a case."""
    rules = {case["rule"] for case in VECTORS["cases"]}
    assert rules >= {
        "changed-upsert",
        "removed-cascade",
        "rootids",
        "remove-before-insert",
        "resync-bad-base",
        "resync-unknown-removal",
        "cursor",
        "composed-invariants",
    }


def test_an_upsert_replaces_a_node_rather_than_merging_it():
    """The single most likely place to diverge, so it is asserted directly.

    A merging implementation passes every other case in the file and fails
    only here, because `state` survives when it should have been replaced away.
    """
    case = next(
        case for case in VECTORS["cases"] if case["name"] == "upsert-replaces-node-wholesale"
    )
    before = by_id(case["base"])["approve"]
    assert before["state"] == {"focused": True}, "the fixture no longer proves anything"

    result = apply_tree_delta(case["base"], case["delta"], DEFAULT_LIMITS)
    assert result.ok
    after = by_id(result.snapshot)["approve"]
    assert "state" not in after, "state survived a wholesale replacement"


def test_a_removal_takes_the_whole_subtree():
    case = next(case for case in VECTORS["cases"] if case["name"] == "remove-cascades-to-the-subtree")
    result = apply_tree_delta(case["base"], case["delta"], DEFAULT_LIMITS)
    assert result.ok
    # Dropping the dialog costs one id and takes its three descendants with it.
    assert set(by_id(result.snapshot)) == {"root"}
    assert len(case["delta"]["removed"]) == 1


def test_removals_are_applied_before_upserts():
    """One delta can move a node out of a subtree it is deleting."""
    case = next(
        case for case in VECTORS["cases"] if case["name"] == "rescue-a-node-out-of-a-removed-subtree"
    )
    result = apply_tree_delta(case["base"], case["delta"], DEFAULT_LIMITS)
    assert result.ok
    nodes = by_id(result.snapshot)
    assert set(nodes) == {"root", "approve"}
    assert nodes["approve"]["parentId"] == "root", "the rescued node kept its old parent"


def test_a_disagreeing_base_is_reported_not_patched():
    for name in ("base-revision-mismatch-resyncs", "base-revision-ahead-resyncs"):
        case = next(case for case in VECTORS["cases"] if case["name"] == name)
        result = apply_tree_delta(case["base"], case["delta"], DEFAULT_LIMITS)
        assert not result.ok and result.code == "revision", name
