//! Semantic side-channel client for the [termwright] terminal test driver.
//!
//! An instrumented TUI publishes its widget tree over a unix socket and
//! commits each render with a signed DCS marker, so tests can assert on *roles
//! and names* instead of screen-scraping cells. This crate is the protocol
//! side of that contract: framing, the marker, message and snapshot
//! validation, and a blocking socket client. It ships no framework adapter —
//! wire it into whatever draws your screen.
//!
//! **Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in
//! the environment, [`Client::from_env`] returns `None` and nothing happens at
//! all: no socket, no marker, no change to what the terminal receives.
//!
//! ```no_run
//! use termwright_protocol::{Client, Node, Options, Rect, Role, Snapshot};
//!
//! let mut client = match Client::from_env(Options::new("my-tui", "1.0.0")) {
//!     Some(client) => client,
//!     None => return, // not instrumented: render normally and stop here
//! };
//! client.connect(termwright_protocol::DIAL_TIMEOUT).expect("handshake");
//!
//! let mut snapshot = Snapshot::new(80, 24);
//! snapshot.push(Node::new("root", Role::Dialog, "Permission"));
//! snapshot.push(
//!     Node::new("ok", Role::Button, "Approve")
//!         .with_parent("root")
//!         .with_bounds(Rect::new(1, 2, 9, 1)),
//! );
//!
//! if let Some(marker) = client.publish(&mut snapshot).expect("publish") {
//!     // Only after the render's last byte has been written.
//!     print!("{marker}");
//! }
//! ```
//!
//! The normative implementation is the TypeScript package
//! `@termwright/protocol`; this crate is verified against the shared vectors
//! in `clients/test-vectors`.
//!
//! [termwright]: https://github.com/gorce-ai/termwright

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod client;
pub mod debug;
pub mod diffing;
pub mod error;
pub mod framing;
pub mod limits;
pub mod logs;
pub mod marker;
pub mod messages;
pub mod roles;
/// Bridge from `tracing`, enabled by the `tracing` feature.
#[cfg(feature = "tracing")]
pub mod tracing_layer;

pub mod tree;
pub mod validate;

pub use client::{Client, Options, DIAL_TIMEOUT, ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN};
pub use debug::{debug_path, Category, DebugLog, ENV_DEBUG, ENV_DEBUG_FILE};
pub use diffing::{build_delta, diff_trees, DELTA_SHARE_CEILING};
pub use error::{Error, ParseError, ValidationError, Violation};
pub use framing::{encode_frame, project_dto, Frame, FrameDecoder, FRAME_HEADER_BYTES};
pub use limits::{Limits, ABSOLUTE_LIMITS, DEFAULT_LIMITS, DEFAULT_NEGOTIATION_MS};
pub use logs::{validate_log_record, AttrValue, LogLevel, LogRecord, LOG_LEVELS, MAX_LOG_ATTRS};
pub use marker::{
    compute_mac, encode_marker, verify_marker_payload, RenderMarker, MARKER_MAC_BYTES,
    MARKER_OSC_CODE, MARKER_OSC_PREFIX,
};
pub use messages::{
    parse_adapter_message, parse_driver_message, ProbeIdentityKind, ProbeInfo, PROTOCOL_ID,
    PROTOCOL_VERSION,
};
pub use roles::{Action, Capability, Role};
pub use tree::{
    Cursor, CursorShape, Node, Occlusion, Orientation, Provenance, Rect, Snapshot, State, TextRange,
};
pub use validate::{apply_tree_delta, validate_snapshot, validate_tree_delta};

/// The fields a node and a state may carry, as this client knows them.
///
/// Exposed so a test can compare them against the protocol's own exported
/// lists: a field added upstream must fail a test here rather than wait to be
/// noticed as a rejected snapshot in production.
pub mod schema_keys {
    pub use crate::validate::{NODE_KEYS, STATE_KEYS};
}
