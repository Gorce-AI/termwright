"""termwright — semantic side-channel client for Python TUIs.

The protocol modules (:mod:`~termwright.framing`, :mod:`~termwright.marker`,
:mod:`~termwright.messages`, :mod:`~termwright.validate`,
:mod:`~termwright.client`) have no third-party dependencies. The Textual
adapter lives in :mod:`termwright.textual_adapter` and is imported lazily, so
importing this package never pulls Textual into a non-Textual process.

    from termwright import client_from_env

    client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0")
    if client is not None and await client.start():
        marker = await client.publish(snapshot)
        sys.stdout.write(marker)   # after the render's last byte
"""

from __future__ import annotations

from typing import Any

from .client import (
    CAPABILITIES_WITH_LOGS,
    DEFAULT_CAPABILITIES,
    ENV_ENDPOINT,
    ENV_PROTOCOL,
    ENV_TOKEN,
    SemanticClient,
    client_from_env,
)
from .errors import ProtocolViolation, TermwrightError
from .framing import FRAME_HEADER_BYTES, FrameDecoder, encode_frame, project_dto
from .limits import ABSOLUTE_LIMITS, DEFAULT_LIMITS, ProtocolLimits
from .logs import (
    LOG_LEVEL_SEVERITY,
    LOG_LEVELS,
    MAX_LOG_ATTRS,
    LogRecord,
    LogValidationResult,
    flatten_attrs,
    validate_log_record,
)
from .marker import (
    MARKER_DCS_FINAL,
    MARKER_DCS_PREFIX,
    MARKER_MAC_BYTES,
    RenderMarker,
    encode_marker,
    verify_marker_payload,
)
from .messages import (
    PROTOCOL_ID,
    PROTOCOL_VERSION,
    ParseResult,
    parse_adapter_message,
    parse_driver_message,
)
from .roles import ADAPTER_CAPABILITIES, SEMANTIC_ACTIONS, SEMANTIC_ROLES
from .tree import (
    CursorInfo,
    Rect,
    SemanticNode,
    SemanticSnapshot,
    SemanticState,
    SemanticTextRange,
)
from .validate import ValidationResult, validate_snapshot

__version__ = "0.1.0"

_LAZY = {"enable_semantics", "TermwrightApp", "TextualSemantics"}

__all__ = [
    "ABSOLUTE_LIMITS",
    "CAPABILITIES_WITH_LOGS",
    "LOG_LEVELS",
    "LOG_LEVEL_SEVERITY",
    "MAX_LOG_ATTRS",
    "LogRecord",
    "LogValidationResult",
    "flatten_attrs",
    "validate_log_record",
    "ADAPTER_CAPABILITIES",
    "DEFAULT_CAPABILITIES",
    "DEFAULT_LIMITS",
    "ENV_ENDPOINT",
    "ENV_PROTOCOL",
    "ENV_TOKEN",
    "FRAME_HEADER_BYTES",
    "FrameDecoder",
    "MARKER_DCS_FINAL",
    "MARKER_DCS_PREFIX",
    "MARKER_MAC_BYTES",
    "PROTOCOL_ID",
    "PROTOCOL_VERSION",
    "ParseResult",
    "ProtocolLimits",
    "ProtocolViolation",
    "RenderMarker",
    "CursorInfo",
    "Rect",
    "SEMANTIC_ACTIONS",
    "SEMANTIC_ROLES",
    "SemanticClient",
    "SemanticNode",
    "SemanticSnapshot",
    "SemanticState",
    "SemanticTextRange",
    "TermwrightApp",
    "TermwrightError",
    "TextualSemantics",
    "ValidationResult",
    "client_from_env",
    "enable_semantics",
    "encode_frame",
    "encode_marker",
    "parse_adapter_message",
    "parse_driver_message",
    "project_dto",
    "validate_snapshot",
    "verify_marker_payload",
]


def __getattr__(name: str) -> Any:
    """Import the Textual adapter only when one of its names is asked for."""
    if name in _LAZY:
        from . import textual_adapter

        return getattr(textual_adapter, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
