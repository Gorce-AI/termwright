"""Message parsing conformance in both directions."""

from __future__ import annotations

import pytest
from conftest import load_vectors

from termwright import (
    DEFAULT_LIMITS,
    PROTOCOL_ID,
    ProtocolLimits,
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


def test_limits_tolerate_ceilings_this_version_does_not_know():
    """A newer driver may add ceilings; an older client must keep talking.

    `limits` is the one object on the wire that grows between versions. If a
    client rejected an unknown ceiling it would close the channel every time
    the protocol gained one, which is exactly what happened when the driver
    started sending the log limits.
    """
    ack = VECTORS["driverToAdapter"]["accept"][0]["message"]
    assert ack["type"] == "hello-ack"

    future = {**ack, "limits": {**ack["limits"], "maxQuantumFlux": 7, "maxTeaPots": 1}}
    result = parse_driver_message(future, DEFAULT_LIMITS)
    assert result.ok, f"a forward-compatible hello-ack was rejected: {result.detail}"

    # The unknown ceilings are ignored, not carried into the typed limits.
    limits = ProtocolLimits.from_wire(result.message["limits"])
    assert limits == DEFAULT_LIMITS


def test_limits_still_require_every_known_ceiling():
    ack = VECTORS["driverToAdapter"]["accept"][0]["message"]
    truncated = {key: value for key, value in ack["limits"].items() if key != "maxNodes"}
    result = parse_driver_message({**ack, "limits": truncated}, DEFAULT_LIMITS)
    assert not result.ok
    assert "maxNodes" in result.detail


def test_tolerance_follows_the_speaker_not_the_message():
    """Driver traffic is read tolerantly; adapter traffic is not.

    The asymmetry is about who is speaking. A driver is the trusted side and
    may grow its messages, so an adapter published today must survive fields
    invented tomorrow. Adapter traffic crosses an untrusted boundary, where an
    unknown field is a signal rather than an extension — and `error` proves the
    point, because it is the same message read both ways.
    """
    error = {"type": "error", "code": "internal", "message": "boom", "trace": "…"}
    assert parse_driver_message(error, DEFAULT_LIMITS).ok
    assert not parse_adapter_message(error, DEFAULT_LIMITS).ok


def test_closed_sets_stay_closed_in_both_directions():
    """Tolerance is not leniency: a vocabulary is not a growth point."""
    ack = VECTORS["driverToAdapter"]["accept"][0]["message"]
    assert not parse_driver_message({**ack, "subscribe": "everything"}, DEFAULT_LIMITS).ok
    assert not parse_driver_message(
        {"type": "error", "code": "meltdown", "message": "x"}, DEFAULT_LIMITS
    ).ok
    assert not parse_driver_message({**ack, "type": "hello-ack-v2"}, DEFAULT_LIMITS).ok
    # Known fields keep their types even when unknown ones are tolerated.
    assert not parse_driver_message(
        {**ack, "marker": {"enabled": "yes", "style": "dcs"}}, DEFAULT_LIMITS
    ).ok
