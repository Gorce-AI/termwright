"""Framing conformance against the shared cross-language vectors."""

from __future__ import annotations

import pytest
from conftest import load_vectors

from termwright import DEFAULT_LIMITS, FrameDecoder, ProtocolViolation, encode_frame

VECTORS = load_vectors("framing")
CEILING = VECTORS["maxFrameBytes"]


def decoder() -> FrameDecoder:
    return FrameDecoder(CEILING, DEFAULT_LIMITS.maxDepth)


@pytest.mark.parametrize("case", VECTORS["encode"], ids=lambda case: case["name"])
def test_encode_matches_reference_bytes(case):
    assert encode_frame(case["value"], CEILING).hex() == case["frameHex"]


@pytest.mark.parametrize("case", VECTORS["decode"], ids=lambda case: case["name"])
def test_decode_yields_reference_messages(case):
    instance = decoder()
    produced = []
    for chunk in case["chunksHex"]:
        produced.extend(instance.push(bytes.fromhex(chunk)))
    assert produced == case["messages"]
    assert instance.buffered == 0


@pytest.mark.parametrize("case", VECTORS["reject"], ids=lambda case: case["name"])
def test_hostile_frames_are_rejected_with_the_same_code(case):
    instance = decoder()
    with pytest.raises(ProtocolViolation) as raised:
        instance.push(bytes.fromhex(case["streamHex"]))
    assert raised.value.code == case["code"]


def test_a_failed_decoder_never_resumes():
    instance = decoder()
    with pytest.raises(ProtocolViolation):
        instance.push(b"\x00\x00\x00\x00")
    with pytest.raises(ProtocolViolation) as raised:
        instance.push(encode_frame({"type": "revision-commit", "revision": 1}, CEILING))
    assert raised.value.code == "decoder-poisoned"


def test_partial_frames_are_buffered_not_returned():
    instance = decoder()
    frame = encode_frame({"type": "revision-commit", "revision": 1}, CEILING)
    assert instance.push(frame[:-1]) == []
    assert instance.buffered == len(frame) - 1
    assert instance.push(frame[-1:]) == [{"type": "revision-commit", "revision": 1}]


def test_encoding_over_the_ceiling_fails_closed():
    with pytest.raises(ProtocolViolation) as raised:
        encode_frame({"pad": "x" * 128}, 32)
    assert raised.value.code == "frame-oversized"


def test_round_trip_of_every_encode_vector():
    instance = decoder()
    for case in VECTORS["encode"]:
        assert instance.push(encode_frame(case["value"], CEILING)) == [case["value"]]
