"""termwright — semantic side-channel client for Python TUIs.

The protocol modules (:mod:`~termwright.framing`, :mod:`~termwright.marker`,
:mod:`~termwright.messages`, :mod:`~termwright.validate`,
:mod:`~termwright.client`) have no third-party dependencies. Textual is
instrumented automatically by :mod:`termwright_probe`; custom widgets may opt
into developer intent with :func:`termwright.textual.semantic`.

    from termwright import client_from_env

    client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0")
    if client is not None and await client.start():
        marker = await client.publish(snapshot)
        sys.stdout.write(marker)   # after the render's last byte
"""

from __future__ import annotations

from .client import (
    CAPABILITIES_WITH_LOGS,
    DEFAULT_CAPABILITIES,
    ENV_ENDPOINT,
    ENV_TOKEN,
    SemanticClient,
    client_from_env,
)
from .debug import ENV_DEBUG, ENV_DEBUG_FILE, DebugLog, debug_path
from .errors import ProtocolViolation, TermwrightError
from .evidence import (
    ApplicationActionStrategyProvider,
    ApplicationFocusEvidenceProvider,
    ApplicationScrollEvidenceProvider,
    ApplicationPaintEvidenceProvider,
    ApplicationTerminalInputModeEvidenceProvider,
    EvidenceProviderLifecycleError,
    EvidenceProviderRegistry,
    EvidenceProviderRegistration,
    EvidenceRevisionContext,
    default_evidence_provider_registry,
    register_action_strategy_provider,
    register_focus_evidence_provider,
    register_scroll_evidence_provider,
    register_paint_evidence_provider,
    register_terminal_input_mode_evidence_provider,
)
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
    MARKER_MAC_BYTES,
    MARKER_OSC_CODE,
    MARKER_OSC_PREFIX,
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
from .roles import (
    ADAPTER_CAPABILITIES,
    EVIDENCE_PROVIDER_CAPABILITIES,
    SEMANTIC_ACTIONS,
    SEMANTIC_ROLES,
)
from .tree import (
    EvidenceProvenance,
    CursorInfo,
    NodeGeometryObservations,
    Observation,
    framework_evidence,
    Rect,
    SemanticNode,
    SemanticSnapshot,
    SemanticScrollState,
    SemanticPaintedRegion,
    SemanticState,
    SemanticTextRange,
    SemanticValueObservation,
)
from .validate import ValidationResult, validate_snapshot

__version__ = "0.4.1"

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
    "ApplicationActionStrategyProvider",
    "ApplicationFocusEvidenceProvider",
    "ApplicationScrollEvidenceProvider",
    "ApplicationPaintEvidenceProvider",
    "ApplicationTerminalInputModeEvidenceProvider",
    "DEFAULT_CAPABILITIES",
    "DEFAULT_LIMITS",
    "DebugLog",
    "ENV_DEBUG",
    "ENV_DEBUG_FILE",
    "ENV_ENDPOINT",
    "ENV_TOKEN",
    "EvidenceProviderLifecycleError",
    "EvidenceProviderRegistry",
    "EvidenceProviderRegistration",
    "EvidenceRevisionContext",
    "EVIDENCE_PROVIDER_CAPABILITIES",
    "FRAME_HEADER_BYTES",
    "FrameDecoder",
    "MARKER_MAC_BYTES",
    "MARKER_OSC_CODE",
    "MARKER_OSC_PREFIX",
    "PROTOCOL_ID",
    "PROTOCOL_VERSION",
    "ParseResult",
    "ProtocolLimits",
    "ProtocolViolation",
    "RenderMarker",
    "CursorInfo",
    "EvidenceProvenance",
    "NodeGeometryObservations",
    "Observation",
    "framework_evidence",
    "Rect",
    "SEMANTIC_ACTIONS",
    "SEMANTIC_ROLES",
    "SemanticClient",
    "SemanticNode",
    "SemanticSnapshot",
    "SemanticScrollState",
    "SemanticPaintedRegion",
    "SemanticState",
    "SemanticTextRange",
    "SemanticValueObservation",
    "TermwrightError",
    "ValidationResult",
    "client_from_env",
    "debug_path",
    "default_evidence_provider_registry",
    "encode_frame",
    "encode_marker",
    "parse_adapter_message",
    "parse_driver_message",
    "project_dto",
    "register_action_strategy_provider",
    "register_focus_evidence_provider",
    "register_scroll_evidence_provider",
    "register_paint_evidence_provider",
    "register_terminal_input_mode_evidence_provider",
    "validate_snapshot",
    "verify_marker_payload",
]
