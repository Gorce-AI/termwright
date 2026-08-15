"""Wire messages: builders for what an adapter sends, parsers for what it receives.

Transport is length-prefixed JSON frames (see :mod:`termwright.framing`). The
adapter pushes commits; the driver issues requests; either side may send an
error and close. Everything is validated against the active limits before it is
retained, and failures are returned as typed results rather than raised.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Sequence

from .errors import ProtocolViolation
from .framing import project_dto
from .limits import DEFAULT_LIMITS, LIMIT_FIELDS, ProtocolLimits
from .roles import CAPABILITY_SET
from .validate import validate_snapshot

PROTOCOL_ID = "termwright/1"
PROTOCOL_VERSION = 1

ERROR_CODES = ("bad-token", "bad-version", "malformed", "limit-exceeded", "internal")
SUBSCRIBE_MODES = ("snapshots", "revisions")

MAX_IDENTIFIER_LENGTH = 1024
_MAX_SAFE_INTEGER = 2**53 - 1


@dataclass(frozen=True)
class ParseResult:
    """Outcome of parsing one wire message."""

    ok: bool
    message: Optional[Dict[str, Any]] = None
    code: Optional[str] = None
    detail: str = ""


def _malformed(detail: str) -> ParseResult:
    return ParseResult(ok=False, code="malformed", detail=detail)


# --------------------------------------------------------------------------
# Builders (adapter → driver)
# --------------------------------------------------------------------------


def hello(token: str, adapter_name: str, adapter_version: str, capabilities: Sequence[str]) -> Dict[str, Any]:
    """Build the handshake message. Unknown capabilities are refused locally."""
    unknown = [item for item in capabilities if item not in CAPABILITY_SET]
    if unknown:
        raise ProtocolViolation("marker-argument", f"unknown capabilities: {', '.join(unknown)}")
    return {
        "type": "hello",
        "protocol": PROTOCOL_ID,
        "token": token,
        "adapter": {"name": adapter_name, "version": adapter_version},
        "capabilities": list(capabilities),
    }


def snapshot_message(snapshot: Mapping[str, Any]) -> Dict[str, Any]:
    """Wrap a wire-form snapshot in its envelope."""
    return {"type": "snapshot", "snapshot": dict(snapshot)}


def revision_commit(revision: int) -> Dict[str, Any]:
    """Announce that ``revision`` has been committed to the terminal."""
    return {"type": "revision-commit", "revision": revision}


def get_tree_result(request_id: int, snapshot: Optional[Mapping[str, Any]] = None, error: Optional[str] = None) -> Dict[str, Any]:
    """Answer a ``get-tree`` request with exactly one of a snapshot or an error."""
    if (snapshot is None) == (error is None):
        raise ProtocolViolation("marker-argument", "exactly one of snapshot or error must be given")
    if snapshot is not None:
        return {"type": "get-tree-result", "requestId": request_id, "snapshot": dict(snapshot)}
    return {"type": "get-tree-result", "requestId": request_id, "error": error}


def protocol_error(code: str, message: str) -> Dict[str, Any]:
    """Build a terminal error message; the sender closes after emitting it."""
    if code not in ERROR_CODES:
        raise ProtocolViolation("marker-argument", f"unknown error code {code}")
    return {"type": "error", "code": code, "message": message}


# --------------------------------------------------------------------------
# Parsers
# --------------------------------------------------------------------------


def _project(value: Any, limits: ProtocolLimits) -> ParseResult:
    try:
        return ParseResult(ok=True, message=project_dto(value, limits.maxDepth))
    except ProtocolViolation as error:
        if error.code == "dto-depth":
            return ParseResult(ok=False, code="limit-exceeded", detail=str(error))
        return _malformed(str(error))


def _identifier(value: Any, field: str, allow_empty: bool = False) -> Optional[str]:
    if not isinstance(value, str):
        return f"{field}: expected a string"
    if len(value) > MAX_IDENTIFIER_LENGTH:
        return f"{field}: expected at most {MAX_IDENTIFIER_LENGTH} characters"
    if not allow_empty and not value:
        return f"{field}: expected a non-empty string"
    return None


def _index(value: Any, field: str) -> Optional[str]:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > _MAX_SAFE_INTEGER:
        return f"{field}: expected a non-negative safe integer"
    return None


def _revision(value: Any, field: str) -> Optional[str]:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > _MAX_SAFE_INTEGER:
        return f"{field}: expected a positive safe integer"
    return None


def _exact_keys(message: Mapping[str, Any], required: Sequence[str], optional: Sequence[str] = ()) -> Optional[str]:
    missing = [key for key in required if key not in message]
    if missing:
        return f"missing field(s): {', '.join(missing)}"
    allowed = set(required) | set(optional)
    unknown = [key for key in message if key not in allowed]
    if unknown:
        return f"unrecognized key(s): {', '.join(unknown)}"
    return None


def _check_snapshot(value: Any, limits: ProtocolLimits) -> Optional[ParseResult]:
    result = validate_snapshot(value, limits)
    if result.ok:
        return None
    over_capacity = result.code in ("bytes", "count", "depth", "string-bytes")
    return ParseResult(
        ok=False,
        code="limit-exceeded" if over_capacity else "malformed",
        detail=f"snapshot {result.code}: {result.detail}",
    )


def _check_error(message: Mapping[str, Any]) -> Optional[str]:
    issue = _exact_keys(message, ("type", "code", "message"))
    if issue:
        return issue
    if message["code"] not in ERROR_CODES:
        return f"code: expected one of {', '.join(ERROR_CODES)}"
    return _identifier(message["message"], "message", allow_empty=True)


def parse_adapter_message(value: Any, limits: ProtocolLimits = DEFAULT_LIMITS) -> ParseResult:
    """Parse one adapter → driver message. Never raises."""
    projected = _project(value, limits)
    if not projected.ok:
        return projected
    message = projected.message
    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        return _malformed("unknown or missing message type")

    kind = message["type"]
    if kind == "hello":
        protocol = message.get("protocol")
        if isinstance(protocol, str) and protocol != PROTOCOL_ID:
            return ParseResult(ok=False, code="bad-version", detail=f"unsupported protocol {protocol}")
        issue = _exact_keys(message, ("type", "protocol", "token", "adapter", "capabilities"))
        if issue:
            return _malformed(issue)
        if message["protocol"] != PROTOCOL_ID:
            return _malformed("protocol: expected termwright/1")
        issue = _identifier(message["token"], "token")
        if issue:
            return _malformed(issue)
        adapter = message["adapter"]
        if not isinstance(adapter, dict):
            return _malformed("adapter: expected an object")
        issue = _exact_keys(adapter, ("name", "version"))
        if issue:
            return _malformed(f"adapter: {issue}")
        for field in ("name", "version"):
            issue = _identifier(adapter[field], f"adapter.{field}")
            if issue:
                return _malformed(issue)
        capabilities = message["capabilities"]
        if not isinstance(capabilities, list) or len(capabilities) > len(CAPABILITY_SET):
            return _malformed("capabilities: expected a bounded array")
        for item in capabilities:
            if item not in CAPABILITY_SET:
                return _malformed(f"capabilities: unknown capability {item!r}")
        return ParseResult(ok=True, message=message)

    if kind == "revision-commit":
        issue = _exact_keys(message, ("type", "revision")) or _revision(message.get("revision"), "revision")
        return _malformed(issue) if issue else ParseResult(ok=True, message=message)

    if kind == "snapshot":
        issue = _exact_keys(message, ("type", "snapshot"))
        if issue:
            return _malformed(issue)
        bad = _check_snapshot(message["snapshot"], limits)
        return bad if bad is not None else ParseResult(ok=True, message=message)

    if kind == "get-tree-result":
        issue = _exact_keys(message, ("type", "requestId"), ("snapshot", "error"))
        if issue:
            return _malformed(issue)
        issue = _index(message["requestId"], "requestId")
        if issue:
            return _malformed(issue)
        has_snapshot = "snapshot" in message
        has_error = "error" in message
        if has_snapshot == has_error:
            return _malformed("exactly one of snapshot or error must be present")
        if has_error:
            issue = _identifier(message["error"], "error", allow_empty=True)
            return _malformed(issue) if issue else ParseResult(ok=True, message=message)
        bad = _check_snapshot(message["snapshot"], limits)
        return bad if bad is not None else ParseResult(ok=True, message=message)

    if kind == "error":
        issue = _check_error(message)
        return _malformed(issue) if issue else ParseResult(ok=True, message=message)

    return _malformed("unknown or missing message type")


def parse_driver_message(value: Any, limits: ProtocolLimits = DEFAULT_LIMITS) -> ParseResult:
    """Parse one driver → adapter message. Never raises."""
    projected = _project(value, limits)
    if not projected.ok:
        return projected
    message = projected.message
    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        return _malformed("unknown or missing message type")

    kind = message["type"]
    if kind == "hello-ack":
        protocol = message.get("protocol")
        if isinstance(protocol, str) and protocol != PROTOCOL_ID:
            return ParseResult(ok=False, code="bad-version", detail=f"unsupported protocol {protocol}")
        issue = _exact_keys(message, ("type", "protocol", "sessionId", "limits", "subscribe", "marker"))
        if issue:
            return _malformed(issue)
        if message["protocol"] != PROTOCOL_ID:
            return _malformed("protocol: expected termwright/1")
        issue = _identifier(message["sessionId"], "sessionId")
        if issue:
            return _malformed(issue)
        limits_value = message["limits"]
        if not isinstance(limits_value, dict):
            return _malformed("limits: expected an object")
        issue = _exact_keys(limits_value, LIMIT_FIELDS)
        if issue:
            return _malformed(f"limits: {issue}")
        for field in LIMIT_FIELDS:
            issue = _revision(limits_value[field], f"limits.{field}")
            if issue:
                return _malformed(issue)
        if message["subscribe"] not in SUBSCRIBE_MODES:
            return _malformed("subscribe: expected 'snapshots' or 'revisions'")
        marker = message["marker"]
        if not isinstance(marker, dict):
            return _malformed("marker: expected an object")
        issue = _exact_keys(marker, ("enabled",))
        if issue:
            return _malformed(f"marker: {issue}")
        if not isinstance(marker["enabled"], bool):
            return _malformed("marker.enabled: expected a boolean")
        return ParseResult(ok=True, message=message)

    if kind == "get-tree":
        issue = _exact_keys(message, ("type", "requestId"), ("revision",))
        if issue:
            return _malformed(issue)
        issue = _index(message["requestId"], "requestId")
        if issue:
            return _malformed(issue)
        if "revision" in message:
            issue = _revision(message["revision"], "revision")
            if issue:
                return _malformed(issue)
        return ParseResult(ok=True, message=message)

    if kind == "error":
        issue = _check_error(message)
        return _malformed(issue) if issue else ParseResult(ok=True, message=message)

    return _malformed("unknown or missing message type")
