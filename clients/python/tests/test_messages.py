"""Message parsing conformance in both directions."""

from __future__ import annotations

import pytest
from conftest import load_vectors

from termwright import (
    DEFAULT_LIMITS,
    PROTOCOL_ID,
    parse_adapter_message,
    parse_driver_message,
)
from termwright.messages import hello, get_tree_result, protocol_error, revision_commit

VECTORS = load_vectors("messages")
PARSERS = {"adapterToDriver": parse_adapter_message, "driverToAdapter": parse_driver_message}


def _cases(direction: str, kind: str):
    return [
        pytest.param(direction, case, id=f"{direction}-{case['name']}")
        for case in VECTORS[direction][kind]
    ]


@pytest.mark.parametrize(
    ("direction", "case"), _cases("adapterToDriver", "accept") + _cases("driverToAdapter", "accept")
)
def test_valid_messages_are_accepted(direction, case):
    result = PARSERS[direction](case["message"], DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"
    assert result.message == case["message"]


@pytest.mark.parametrize(
    ("direction", "case"), _cases("adapterToDriver", "reject") + _cases("driverToAdapter", "reject")
)
def test_invalid_messages_are_rejected_with_the_same_code(direction, case):
    result = PARSERS[direction](case["message"], DEFAULT_LIMITS)
    assert not result.ok
    assert result.code == case["code"], result.detail


def test_builders_produce_parseable_messages():
    built = [
        hello("token", "pytest", "0.1.0", ["tree", "bounds"]),
        revision_commit(4),
        get_tree_result(1, error="no such revision"),
        protocol_error("internal", "boom"),
    ]
    for message in built:
        result = parse_adapter_message(message, DEFAULT_LIMITS)
        assert result.ok, f"{message['type']}: {result.code} {result.detail}"
    assert built[0]["protocol"] == PROTOCOL_ID


def test_a_driver_message_is_not_an_adapter_message():
    assert not parse_adapter_message({"type": "get-tree", "requestId": 0}, DEFAULT_LIMITS).ok
    assert not parse_driver_message(revision_commit(1), DEFAULT_LIMITS).ok
