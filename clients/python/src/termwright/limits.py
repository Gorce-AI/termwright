"""Protocol limits. Callers may tighten the defaults, never widen the maxima."""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Any, Dict, Mapping

LIMIT_FIELDS = (
    "maxFrameBytes",
    "maxSnapshotBytes",
    "maxNodes",
    "maxDepth",
    "maxStringBytes",
    "maxRelationTargets",
    "maxQueuedFrames",
    "maxPendingWaiters",
    "maxSessions",
    "maxLogRecordBytes",
    "maxLogQueue",
)


@dataclass(frozen=True)
class ProtocolLimits:
    """Per-session capacity ceilings, wire-named to match the JSON payload."""

    maxFrameBytes: int
    maxSnapshotBytes: int
    maxNodes: int
    maxDepth: int
    maxStringBytes: int
    maxRelationTargets: int
    maxQueuedFrames: int
    maxPendingWaiters: int
    maxSessions: int
    maxLogRecordBytes: int
    maxLogQueue: int

    def to_wire(self) -> Dict[str, int]:
        """Serialise to the JSON object shape used by ``hello-ack``."""
        return {field.name: getattr(self, field.name) for field in fields(self)}

    @staticmethod
    def from_wire(value: Mapping[str, Any]) -> "ProtocolLimits":
        """Build limits from a validated ``hello-ack`` payload.

        Only the fields this version knows are read. A newer driver may send
        ceilings that did not exist when this client was published; ignoring
        them is what lets an old client keep talking to a new driver.
        """
        return ProtocolLimits(**{name: int(value[name]) for name in LIMIT_FIELDS})


DEFAULT_LIMITS = ProtocolLimits(
    maxFrameBytes=1 * 1024 * 1024,
    maxSnapshotBytes=2 * 1024 * 1024,
    maxNodes=5_000,
    maxDepth=64,
    maxStringBytes=16 * 1024,
    maxRelationTargets=64,
    maxQueuedFrames=32,
    maxPendingWaiters=256,
    maxSessions=16,
    maxLogRecordBytes=32 * 1024,
    maxLogQueue=1_000,
)

ABSOLUTE_LIMITS = ProtocolLimits(
    maxFrameBytes=8 * 1024 * 1024,
    maxSnapshotBytes=8 * 1024 * 1024,
    maxNodes=50_000,
    maxDepth=256,
    maxStringBytes=256 * 1024,
    maxRelationTargets=1_024,
    maxQueuedFrames=256,
    maxPendingWaiters=4_096,
    maxSessions=128,
    maxLogRecordBytes=256 * 1024,
    maxLogQueue=10_000,
)

DEFAULT_NEGOTIATION_MS = 250
