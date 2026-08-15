//! Protocol limits. Callers may tighten the defaults, never widen the maxima.

use serde::{Deserialize, Serialize};

/// Per-session capacity ceilings, named as they appear on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    /// Per-frame byte ceiling, header excluded.
    pub max_frame_bytes: usize,
    /// Serialised size ceiling for one snapshot.
    pub max_snapshot_bytes: usize,
    /// Node and root-id count ceiling per snapshot.
    pub max_nodes: usize,
    /// Structural nesting ceiling, roots at depth 1.
    pub max_depth: usize,
    /// UTF-8 byte ceiling for any single string.
    pub max_string_bytes: usize,
    /// Ceiling on `labelledBy`/`describedBy`/`textRanges` entries.
    pub max_relation_targets: usize,
    /// Frames the driver buffers before applying back-pressure.
    pub max_queued_frames: usize,
    /// Concurrent waiters the driver will track.
    pub max_pending_waiters: usize,
    /// Concurrent sessions the driver will hold open.
    pub max_sessions: usize,
}

/// What an adapter assumes until `hello-ack` says otherwise.
pub const DEFAULT_LIMITS: Limits = Limits {
    max_frame_bytes: 1024 * 1024,
    max_snapshot_bytes: 1024 * 1024,
    max_nodes: 5_000,
    max_depth: 64,
    max_string_bytes: 16 * 1024,
    max_relation_targets: 64,
    max_queued_frames: 32,
    max_pending_waiters: 256,
    max_sessions: 16,
};

/// The widest configuration either side may accept.
pub const ABSOLUTE_LIMITS: Limits = Limits {
    max_frame_bytes: 8 * 1024 * 1024,
    max_snapshot_bytes: 8 * 1024 * 1024,
    max_nodes: 50_000,
    max_depth: 256,
    max_string_bytes: 256 * 1024,
    max_relation_targets: 1_024,
    max_queued_frames: 256,
    max_pending_waiters: 4_096,
    max_sessions: 128,
};

/// Milliseconds a driver waits for a `hello` before settling the session as
/// generic (non-semantic).
pub const DEFAULT_NEGOTIATION_MS: u64 = 250;

impl Default for Limits {
    fn default() -> Self {
        DEFAULT_LIMITS
    }
}
