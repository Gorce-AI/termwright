"""Application log records carried over the semantic channel.

A TUI cannot print diagnostics to the screen without corrupting the render, so
applications write them to a logger instead. The ``logs`` capability forwards
those records to the driver, where they become assertable test state rather
than invisible side effects.

Records are bounded exactly like snapshots: checked against a byte ceiling and
rejected wholesale on any violation, so a misbehaving logger degrades into
dropped records rather than unbounded driver memory.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Union

from .framing import encode_json, project_dto
from .errors import ProtocolViolation
from .limits import DEFAULT_LIMITS, ProtocolLimits

#: Severity ladder, least to most severe. The intersection of the ladders used
#: by Python ``logging``, Go ``slog``, Rust ``tracing``, pino and winston, so
#: every bridge maps onto it without inventing a level.
LOG_LEVELS = ("trace", "debug", "info", "warn", "error", "fatal")

LEVEL_SET = frozenset(LOG_LEVELS)

#: Numeric severity; higher is more severe.
LOG_LEVEL_SEVERITY: Dict[str, int] = {
    "trace": 10,
    "debug": 20,
    "info": 30,
    "warn": 40,
    "error": 50,
    "fatal": 60,
}

#: Maximum number of attribute keys on one record.
MAX_LOG_ATTRS = 64

RECORD_FIELDS = ("ts", "level", "message", "attrs", "logger", "seq", "revision")

_MAX_SAFE_INTEGER = 2**53 - 1

#: Values an attribute may hold. Scalars only: nested objects make record size
#: unbounded and depth-dependent, and every bridge already flattens for its own
#: transport.
LogAttrValue = Union[str, int, float, bool, None]


@dataclass(frozen=True)
class LogRecord:
    """One application log record.

    ``ts`` is Unix epoch milliseconds, not session-relative: an adapter has no
    reliable view of when the driver considers the session to have started, so
    the wall clock is the only clock both sides agree on without negotiating.
    The driver rebases it onto the session timeline.
    """

    ts: int
    level: str
    message: str
    seq: int
    attrs: Optional[Mapping[str, LogAttrValue]] = None
    logger: Optional[str] = None
    revision: Optional[int] = None

    def to_wire(self) -> Dict[str, Any]:
        """Serialise, dropping unset optionals: the schema is strict."""
        wire: Dict[str, Any] = {"ts": self.ts, "level": self.level, "message": self.message}
        if self.attrs is not None:
            wire["attrs"] = dict(self.attrs)
        if self.logger is not None:
            wire["logger"] = self.logger
        wire["seq"] = self.seq
        if self.revision is not None:
            wire["revision"] = self.revision
        return wire


@dataclass(frozen=True)
class LogValidationResult:
    """Outcome of :func:`validate_log_record`."""

    ok: bool
    record: Optional[Dict[str, Any]] = None
    code: Optional[str] = None
    detail: str = ""


def _fail(code: str, detail: str) -> LogValidationResult:
    return LogValidationResult(ok=False, code=code, detail=detail)


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8", "surrogatepass"))


def _safe_non_negative(value: Any) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= _MAX_SAFE_INTEGER
    )


def validate_log_record(
    value: Any, limits: ProtocolLimits = DEFAULT_LIMITS
) -> LogValidationResult:
    """Validate an untrusted log record against ``limits``.

    Mirrors :func:`termwright.validate.validate_snapshot`: the value is
    projected first, then measured against ``maxLogRecordBytes``, then checked
    field by field. Never raises.
    """
    try:
        projected = project_dto(value, limits.maxDepth)
    except ProtocolViolation as error:
        return _fail("depth" if error.code == "dto-depth" else "schema", str(error))

    try:
        serialised = encode_json(projected)
    except ProtocolViolation:
        return _fail("schema", "log record is not JSON-serialisable")
    if len(serialised) > limits.maxLogRecordBytes:
        return _fail(
            "bytes",
            f"log record is {len(serialised)} bytes, ceiling is {limits.maxLogRecordBytes}",
        )

    if not isinstance(projected, dict):
        return _fail("schema", "log record must be an object")
    record: Dict[str, Any] = projected

    for key in record:
        if key not in RECORD_FIELDS:
            return _fail("schema", f'unknown log record property "{key}"')

    if not _safe_non_negative(record.get("ts")) or record["ts"] == 0:
        return _fail("schema", "ts must be a positive safe integer (epoch milliseconds)")
    if record.get("level") not in LEVEL_SET:
        return _fail("schema", f"level must be one of {', '.join(LOG_LEVELS)}")
    if not isinstance(record.get("message"), str):
        return _fail("schema", "message must be a string")
    if _utf8_len(record["message"]) > limits.maxStringBytes:
        return _fail("string-bytes", f"message exceeds {limits.maxStringBytes} UTF-8 bytes")
    if not _safe_non_negative(record.get("seq")):
        return _fail("schema", "seq must be a non-negative safe integer")

    if "logger" in record:
        if not isinstance(record["logger"], str):
            return _fail("schema", "logger must be a string")
        if _utf8_len(record["logger"]) > limits.maxStringBytes:
            return _fail("string-bytes", f"logger exceeds {limits.maxStringBytes} UTF-8 bytes")

    if "revision" in record:
        if not _safe_non_negative(record["revision"]) or record["revision"] == 0:
            return _fail("revision", "revision must be a positive safe integer")

    if "attrs" in record:
        attrs = record["attrs"]
        if not isinstance(attrs, dict):
            return _fail("schema", "attrs must be a flat object")
        if len(attrs) > MAX_LOG_ATTRS:
            return _fail("count", f"attrs carries {len(attrs)} keys, ceiling is {MAX_LOG_ATTRS}")
        for key, attr in attrs.items():
            if _utf8_len(key) > limits.maxStringBytes:
                return _fail("string-bytes", f'attribute key "{key}" exceeds the string ceiling')
            if attr is not None and not isinstance(attr, (str, int, float, bool)):
                return _fail(
                    "schema", f'attribute "{key}" must be a string, number, boolean or null'
                )
            if isinstance(attr, float) and (attr != attr or attr in (float("inf"), float("-inf"))):
                return _fail("schema", f'attribute "{key}" must be a finite number')
            if isinstance(attr, str) and _utf8_len(attr) > limits.maxStringBytes:
                return _fail("string-bytes", f'attribute "{key}" exceeds the string ceiling')

    return LogValidationResult(ok=True, record=record)


def flatten_attrs(
    value: Mapping[str, Any], prefix: str = "", depth: int = 0
) -> Dict[str, LogAttrValue]:
    """Flatten nested context into dotted keys, as the wire format requires.

    ``{"db": {"host": "x"}}`` becomes ``{"db.host": "x"}``. Values that are not
    scalars after flattening are rendered with :func:`repr`, because losing the
    shape of a value is better than dropping the record that carries it.
    """
    flat: Dict[str, LogAttrValue] = {}
    for key, item in value.items():
        name = f"{prefix}{key}"
        if isinstance(item, Mapping) and depth < 4:
            flat.update(flatten_attrs(item, f"{name}.", depth + 1))
        elif item is None or isinstance(item, (str, bool, int)):
            flat[name] = item
        elif isinstance(item, float):
            flat[name] = item if item == item and item not in (float("inf"), float("-inf")) else str(item)
        else:
            try:
                flat[name] = json.dumps(item, default=repr)
            except (TypeError, ValueError):
                flat[name] = repr(item)
    return flat
