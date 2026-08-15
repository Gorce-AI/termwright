"""Marker MACs must match the TypeScript implementation bit for bit."""

from __future__ import annotations

import pytest
from conftest import load_vectors

from termwright import ProtocolViolation, encode_marker, verify_marker_payload

VECTORS = load_vectors("marker")


def _id(case):
    return f"{case['sessionId']}-r{case['revision']}"


@pytest.mark.parametrize("case", VECTORS["encode"], ids=_id)
def test_marker_sequence_matches_reference(case):
    sequence = encode_marker(case["token"], case["sessionId"], case["revision"])
    assert sequence == case["sequence"]
    assert sequence.encode("utf-8").hex() == case["sequenceHex"]


@pytest.mark.parametrize("case", VECTORS["encode"], ids=_id)
def test_reference_markers_verify(case):
    marker = verify_marker_payload(case["payload"], case["token"], case["sessionId"])
    assert marker is not None
    assert marker.revision == case["revision"]
    assert marker.mac == case["mac"]


@pytest.mark.parametrize("case", VECTORS["verifyReject"], ids=lambda case: case["name"])
def test_forged_markers_do_not_verify(case):
    assert verify_marker_payload(case["payload"], case["token"], case["sessionId"]) is None


def test_a_marker_does_not_verify_under_another_token():
    case = VECTORS["encode"][0]
    assert verify_marker_payload(case["payload"], "different-token", case["sessionId"]) is None


@pytest.mark.parametrize("revision", [0, -1, 1.5, True, 2**53])
def test_encoding_rejects_non_revisions(revision):
    with pytest.raises(ProtocolViolation):
        encode_marker("token", "session", revision)


@pytest.mark.parametrize(("token", "session"), [("", "s"), ("t", "")])
def test_encoding_rejects_empty_credentials(token, session):
    with pytest.raises(ProtocolViolation):
        encode_marker(token, session, 1)
