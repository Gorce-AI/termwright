"""Wire framing: 4-byte big-endian unsigned length prefix + UTF-8 JSON body.

The declared length is checked against ``max_frame_bytes`` before any decoding.
Anything oversized, partial past the ceiling, or structurally hostile fails
closed with :class:`ProtocolViolation`, and a failed decoder never resumes:
resynchronising on an attacker-chosen offset is worse than dropping the link.
"""

from __future__ import annotations

import json
import re
from typing import Any, List, Optional

from .errors import ProtocolViolation

FRAME_HEADER_BYTES = 4

#: Property names that carry meaning in JavaScript engines. The reference
#: implementation rejects them, so we reject them too — a Python adapter must
#: not be able to smuggle a payload past a JS driver's projection.
RESERVED_KEYS = frozenset({"__proto__", "constructor", "prototype"})

_LONE_SURROGATE = re.compile("[\ud800-\udfff]")

_JSON_SEPARATORS = (",", ":")


def _reject_constant(name: str) -> Any:
    raise ProtocolViolation("dto-scalar", f"non-finite number literal {name}")


def _check_string(value: str, path: str, what: str) -> None:
    if _LONE_SURROGATE.search(value):
        raise ProtocolViolation("dto-string", f"unpaired surrogate in {what} at {path}")


def project_dto(value: Any, max_depth: int, _depth: int = 0, _path: str = "$") -> Any:
    """Deep-check an untrusted parsed value and return a JSON-safe copy.

    :param value: Untrusted input, typically the result of :func:`json.loads`.
    :param max_depth: Maximum nesting depth; the root sits at depth 0.
    :raises ProtocolViolation: On reserved keys, unpaired surrogates, non-finite
        numbers, non-JSON types, or nesting beyond ``max_depth``.
    """
    if _depth == 0 and (not isinstance(max_depth, int) or max_depth < 0):
        raise ProtocolViolation("dto-depth", "max_depth must be a non-negative integer")

    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ProtocolViolation("dto-scalar", f"non-finite number at {_path}")
        return value
    if isinstance(value, str):
        _check_string(value, _path, "string")
        return value

    if _depth > max_depth:
        raise ProtocolViolation("dto-depth", f"nesting exceeds {max_depth} at {_path}")

    if isinstance(value, list):
        return [
            project_dto(item, max_depth, _depth + 1, f"{_path}[{index}]")
            for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        projected = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolViolation("dto-key", f"non-string key at {_path}")
            if key in RESERVED_KEYS:
                raise ProtocolViolation("dto-key", f'reserved property name "{key}" at {_path}')
            _check_string(key, _path, "key")
            projected[key] = project_dto(item, max_depth, _depth + 1, f"{_path}.{key}")
        return projected

    raise ProtocolViolation(
        "dto-scalar", f"value of type {type(value).__name__} is not JSON-representable at {_path}"
    )


def encode_json(message: Any) -> bytes:
    """Serialise to the canonical UTF-8 JSON body (no spaces, no NaN)."""
    try:
        text = json.dumps(message, ensure_ascii=False, separators=_JSON_SEPARATORS, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ProtocolViolation("frame-malformed", "message is not JSON-serialisable") from error
    try:
        return text.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ProtocolViolation("dto-string", "message contains an unpaired surrogate") from error


def encode_frame(message: Any, max_frame_bytes: int) -> bytes:
    """Serialise a message into a single length-prefixed frame.

    :raises ProtocolViolation: If the value is not JSON-representable or the
        encoded body exceeds ``max_frame_bytes``.
    """
    _assert_ceiling(max_frame_bytes)
    body = encode_json(message)
    if len(body) > max_frame_bytes:
        raise ProtocolViolation(
            "frame-oversized",
            f"encoded frame is {len(body)} bytes, ceiling is {max_frame_bytes}",
        )
    return len(body).to_bytes(FRAME_HEADER_BYTES, "big") + body


def _assert_ceiling(max_frame_bytes: int) -> None:
    if not isinstance(max_frame_bytes, int) or isinstance(max_frame_bytes, bool) or max_frame_bytes <= 0:
        raise ProtocolViolation("frame-malformed", "max_frame_bytes must be a positive integer")


def decode_body(body: bytes, max_depth: int) -> Any:
    """Decode one frame body into a projected DTO."""
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProtocolViolation("frame-encoding", "frame body is not valid UTF-8") from error
    try:
        parsed = json.loads(text, parse_constant=_reject_constant)
    except ProtocolViolation:
        raise
    except (ValueError, RecursionError) as error:
        raise ProtocolViolation("frame-malformed", "frame body is not valid JSON") from error
    return project_dto(parsed, max_depth)


class FrameDecoder:
    """Streaming decoder for length-prefixed JSON frames.

    Feed arbitrary chunks to :meth:`push`; it returns the messages that became
    complete. The first violation poisons the instance permanently.
    """

    def __init__(self, max_frame_bytes: int, max_depth: int) -> None:
        _assert_ceiling(max_frame_bytes)
        self._max_frame_bytes = max_frame_bytes
        self._max_depth = max_depth
        self._buffer = bytearray()
        self._failure: Optional[ProtocolViolation] = None

    @property
    def buffered(self) -> int:
        """Bytes held back waiting for the rest of a frame."""
        return len(self._buffer)

    def push(self, chunk: bytes) -> List[Any]:
        """Feed raw bytes; return the frames that completed, in order."""
        if self._failure is not None:
            raise ProtocolViolation(
                "decoder-poisoned",
                f"decoder failed earlier ({self._failure.code}) and accepts no further input",
            )
        try:
            return self._push_or_raise(chunk)
        except ProtocolViolation as error:
            self._failure = error
            self._buffer = bytearray()
            raise
        except Exception as error:  # pragma: no cover - defensive
            self._failure = ProtocolViolation("frame-malformed", "frame decoding failed")
            self._buffer = bytearray()
            raise self._failure from error

    def _push_or_raise(self, chunk: bytes) -> List[Any]:
        self._buffer.extend(chunk)
        messages: List[Any] = []
        offset = 0

        while len(self._buffer) - offset >= FRAME_HEADER_BYTES:
            length = int.from_bytes(self._buffer[offset : offset + FRAME_HEADER_BYTES], "big")
            if length == 0:
                raise ProtocolViolation("frame-malformed", "frame length must be non-zero")
            if length > self._max_frame_bytes:
                raise ProtocolViolation(
                    "frame-oversized",
                    f"frame declares {length} bytes, ceiling is {self._max_frame_bytes}",
                )
            end = offset + FRAME_HEADER_BYTES + length
            if len(self._buffer) < end:
                break
            messages.append(decode_body(bytes(self._buffer[offset + FRAME_HEADER_BYTES : end]), self._max_depth))
            offset = end

        if offset:
            del self._buffer[:offset]
        if len(self._buffer) > self._max_frame_bytes + FRAME_HEADER_BYTES:
            raise ProtocolViolation(
                "frame-oversized", f"buffered {len(self._buffer)} bytes without a complete frame"
            )
        return messages
