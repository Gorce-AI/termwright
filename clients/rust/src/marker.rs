//! Render-commit marker.
//!
//! The adapter writes this DCS sequence to stdout *after* the last byte of the
//! render belonging to revision N. It commits a frame; it never carries data.
//!
//! ```text
//! ESC P twm;<revision>;<mac> ESC \
//! ```
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

/// Prefix that opens the marker payload inside the DCS sequence.
pub const MARKER_DCS_PREFIX: &str = "twm;";

/// The DCS final byte a VT parser dispatches on.
pub const MARKER_DCS_FINAL: &str = "t";

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
        "\x1bP{MARKER_DCS_PREFIX}{revision};{}\x1b\\",
        compute_mac(token, session_id, revision)
    ))
}

/// Parse and verify a DCS payload, i.e. the bytes between `ESC P` and `ESC \`.
///
/// Total function: hostile payloads yield `None`, never an error to interpret.
/// Only canonically formatted revisions are accepted, so `1` and `01` cannot
/// both authenticate the same commit, and the MAC compare is constant time.
pub fn verify_marker_payload(payload: &str, token: &str, session_id: &str) -> Option<RenderMarker> {
    if token.is_empty() || session_id.is_empty() {
        return None;
    }
    let body = payload.strip_prefix(MARKER_DCS_PREFIX)?;
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
