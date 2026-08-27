//! Render-commit marker.
//!
//! The adapter writes this OSC sequence to stdout *after* the last byte of the
//! render belonging to revision N. It commits a frame; it never carries data.
//!
//! ```text
//! OSC 8487 ; twm;<revision>;<mac> BEL
//! ```
//!
//! The legacy frame-based inbox ConPTY dropped DCS, APC and OSC 8 while private
//! OSC survived. Termwright's pinned passthrough ConPTY now forwards those
//! families, but OSC 8487 remains the one encoding certified across every host.
//!
//! with `mac = base64url(HMAC-SHA256(token, "{session_id}:{revision}"))[..16]`,
//! unpadded. The token is an opaque UTF-8 string end to end: whatever arrives
//! in `TERMWRIGHT_TOKEN` is used as key bytes, never decoded first.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::error::Violation;

/// The private OSC number carrying render-commit markers. Chosen clear of
/// everything in use (xterm's allocations, OSC 8, 9, 99, 133, 633, 697, 777+):
/// 84 and 87 are the ASCII codes of `T` and `W`, for termwright.
pub const MARKER_OSC_CODE: u32 = 8487;

/// The tag opening a marker payload, immediately after `OSC 8487;`. A
/// self-identifying guard: if anything ever claims 8487, a marker still says
/// what it is rather than being mistaken for that feature's payload.
pub const MARKER_OSC_PREFIX: &str = "twm;";

/// The terminator this implementation emits — the one ConPTY was observed to
/// forward most reliably.
const BEL: &str = "\x07";

/// The terminator a receiver must also accept.
const ST: &str = "\x1b\\";

/// How much of the HMAC-SHA256 output the marker retains.
pub const MARKER_MAC_BYTES: usize = 16;

/// Length of the unpadded base64url MAC.
const MARKER_MAC_CHARS: usize = 22;

/// Largest revision that survives a round trip through the JavaScript
/// reference implementation unchanged.
pub const MAX_SAFE_INTEGER: i64 = (1i64 << 53) - 1;

/// A verified marker: the revision it commits, and the MAC that proved it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderMarker {
    /// The committed revision.
    pub revision: i64,
    /// The MAC exactly as it appeared on the wire.
    pub mac: String,
}

/// Compute the marker MAC for a session and revision.
pub fn compute_mac(token: &str, session_id: &str, revision: i64) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(token.as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(format!("{session_id}:{revision}").as_bytes());
    let digest = mac.finalize().into_bytes();
    URL_SAFE_NO_PAD.encode(&digest[..MARKER_MAC_BYTES])
}

/// Build the full escape sequence committing `revision`.
///
/// # Errors
/// Returns a [`Violation`] on an empty token or session id, or a revision that
/// is not a positive safe integer.
pub fn encode_marker(token: &str, session_id: &str, revision: i64) -> Result<String, Violation> {
    if token.is_empty() {
        return Err(Violation::new("marker-argument", "token must not be empty"));
    }
    if session_id.is_empty() {
        return Err(Violation::new(
            "marker-argument",
            "sessionId must not be empty",
        ));
    }
    if revision <= 0 || revision > MAX_SAFE_INTEGER {
        return Err(Violation::new(
            "marker-argument",
            "revision must be a positive safe integer",
        ));
    }
    Ok(format!(
        "\x1b]{MARKER_OSC_CODE};{MARKER_OSC_PREFIX}{revision};{}{BEL}",
        compute_mac(token, session_id, revision)
    ))
}

/// Parse and verify an OSC payload — everything after `OSC 8487;`.
///
/// Total function: hostile payloads yield `None`, never an error to interpret.
/// Only canonically formatted revisions are accepted, so `1` and `01` cannot
/// both authenticate the same commit, and the MAC compare is constant time.
///
/// A trailing BEL or ST is tolerated: a VT parser consumes the terminator
/// before dispatching, so a handler normally passes a payload without one,
/// while a caller scanning raw output with a regex keeps it. Both must work.
pub fn verify_marker_payload(payload: &str, token: &str, session_id: &str) -> Option<RenderMarker> {
    if token.is_empty() || session_id.is_empty() {
        return None;
    }
    let text = payload
        .strip_suffix(BEL)
        .or_else(|| payload.strip_suffix(ST))
        .unwrap_or(payload);
    let body = text.strip_prefix(MARKER_OSC_PREFIX)?;
    let (revision_text, mac) = body.split_once(';')?;
    if !canonical_revision(revision_text) || !canonical_mac(mac) {
        return None;
    }
    let revision: i64 = revision_text.parse().ok()?;
    if revision <= 0 || revision > MAX_SAFE_INTEGER {
        return None;
    }
    let expected = compute_mac(token, session_id, revision);
    if expected.as_bytes().ct_eq(mac.as_bytes()).unwrap_u8() != 1 {
        return None;
    }
    Some(RenderMarker {
        revision,
        mac: mac.to_owned(),
    })
}

/// Accepts `^[1-9][0-9]{0,15}$`: no sign, no leading zero, no whitespace.
fn canonical_revision(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() > 16 || !(b'1'..=b'9').contains(&bytes[0]) {
        return false;
    }
    bytes[1..].iter().all(u8::is_ascii_digit)
}

/// Accepts exactly [`MARKER_MAC_CHARS`] base64url characters.
fn canonical_mac(mac: &str) -> bool {
    mac.len() == MARKER_MAC_CHARS
        && mac
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
