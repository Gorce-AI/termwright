"""Message parsing conformance in both directions."""

from __future__ import annotations

from conftest import node, snapshot

from termwright import (
    DEFAULT_LIMITS,
    PROTOCOL_ID,
    ProtocolLimits,
    parse_adapter_message,
    parse_driver_message,
)
from termwright.messages import hello, protocol_error, revision_commit

PARSERS = {"adapterToDriver": parse_adapter_message, "driverToAdapter": parse_driver_message}


def ack(**changes):
    message = {
        "type": "hello-ack",
        "protocol": PROTOCOL_ID,
        "sessionId": "s-1",
        "limits": DEFAULT_LIMITS.to_wire(),
        "subscribe": "snapshots",
        "marker": {"enabled": True},
    }
    message.update(changes)
    return message


def test_protocol_v2_messages_are_accepted():
    tree = snapshot(nodes=[node(id="root", role="application", name="app")], root_ids=["root"])
    messages = [
        (parse_adapter_message, hello("token", "pytest", "0.1.0", ["tree"])),
        (parse_adapter_message, {"type": "snapshot", "snapshot": tree.to_wire()}),
        (parse_driver_message, ack()),
        (parse_driver_message, ack(subscribe="revisions")),
    ]
    for parser, message in messages:
        result = parser(message, DEFAULT_LIMITS)
        assert result.ok, f"{message['type']}: {result.code} {result.detail}"


def test_protocol_v1_is_rejected_in_both_directions():
    adapter = hello("token", "pytest", "0.1.0", ["tree"])
    adapter["protocol"] = "termwright/1"
    driver = ack(protocol="termwright/1")
    assert parse_adapter_message(adapter, DEFAULT_LIMITS).code == "bad-version"
    assert parse_driver_message(driver, DEFAULT_LIMITS).code == "bad-version"


def test_diff_subscription_and_delta_messages_are_rejected():
    assert not parse_driver_message(ack(subscribe="diffs"), DEFAULT_LIMITS).ok
    delta = {"type": "tree-delta", "baseRevision": 1, "revision": 2, "changed": [], "removed": []}
    assert not parse_adapter_message(delta, DEFAULT_LIMITS).ok


def test_builders_produce_parseable_messages():
    built = [
        hello("token", "pytest", "0.1.0", ["tree"]),
        revision_commit(4),
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
    current = ack()

    future = {**current, "limits": {**current["limits"], "maxQuantumFlux": 7, "maxTeaPots": 1}}
    result = parse_driver_message(future, DEFAULT_LIMITS)
    assert result.ok, f"a forward-compatible hello-ack was rejected: {result.detail}"

    # The unknown ceilings are ignored, not carried into the typed limits.
    limits = ProtocolLimits.from_wire(result.message["limits"])
    assert limits == DEFAULT_LIMITS


def test_limits_still_require_every_known_ceiling():
    current = ack()
    truncated = {key: value for key, value in current["limits"].items() if key != "maxNodes"}
    result = parse_driver_message({**current, "limits": truncated}, DEFAULT_LIMITS)
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
    current = ack()
    assert not parse_driver_message({**current, "subscribe": "everything"}, DEFAULT_LIMITS).ok
    assert not parse_driver_message(
        {"type": "error", "code": "meltdown", "message": "x"}, DEFAULT_LIMITS
    ).ok
    assert not parse_driver_message({**current, "type": "hello-ack-v2"}, DEFAULT_LIMITS).ok
    # Known fields keep their types even when unknown ones are tolerated.
    assert not parse_driver_message(
        {**current, "marker": {"enabled": "yes", "style": "dcs"}}, DEFAULT_LIMITS
    ).ok
