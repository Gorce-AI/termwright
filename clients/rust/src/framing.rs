//! Wire framing: a 4-byte big-endian length prefix and a UTF-8 JSON body.
//!
//! The declared length is checked against the ceiling before any body is
//! decoded, and the first violation poisons the decoder for good:
//! resynchronising on an attacker-chosen offset is worse than dropping the
//! connection.

use serde::Serialize;
use serde_json::Value;

use crate::error::Violation;

/// Size of the length prefix that precedes every frame body.
pub const FRAME_HEADER_BYTES: usize = 4;

/// Property names that carry meaning in JavaScript engines. The reference
/// implementation rejects them, so a Rust adapter cannot smuggle a payload
/// past a JS driver's projection either.
const RESERVED_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// Serialise a value into one length-prefixed frame.
///
/// Pass a [`serde_json::value::RawValue`] when the exact body bytes matter;
/// anything else is encoded by serde.
///
/// # Errors
/// Returns a [`Violation`] when the value is not JSON-encodable or the encoded
/// body exceeds `max_frame_bytes`.
pub fn encode_frame<T: Serialize>(value: &T, max_frame_bytes: usize) -> Result<Vec<u8>, Violation> {
    if max_frame_bytes == 0 {
        return Err(Violation::new(
            "frame-malformed",
            "maxFrameBytes must be positive",
        ));
    }
    let body = serde_json::to_vec(value)
        .map_err(|_| Violation::new("frame-malformed", "message is not JSON-serialisable"))?;
    if body.len() > max_frame_bytes {
        return Err(Violation::new(
            "frame-oversized",
            format!(
                "encoded frame is {} bytes, ceiling is {max_frame_bytes}",
                body.len()
            ),
        ));
    }
    let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

/// Decode and check one frame body.
///
/// # Errors
/// Returns a [`Violation`] for non-UTF-8 bytes, invalid JSON, reserved
/// property names, or nesting beyond `max_depth`.
pub fn decode_body(body: &[u8], max_depth: usize) -> Result<Value, Violation> {
    let text = std::str::from_utf8(body)
        .map_err(|_| Violation::new("frame-encoding", "frame body is not valid UTF-8"))?;
    let value: Value = serde_json::from_str(text)
        .map_err(|_| Violation::new("frame-malformed", "frame body is not valid JSON"))?;
    project_dto(&value, max_depth)?;
    Ok(value)
}

/// Check an untrusted parsed value against the DTO rules.
///
/// Rust cannot express the getter, proxy or sparse-array cases the reference
/// implementation guards against — `serde_json` cannot produce them — so this
/// enforces what remains: reserved property names and the depth ceiling.
/// Non-finite numbers cannot survive JSON parsing at all.
///
/// # Errors
/// Returns a [`Violation`] with code `dto-key` or `dto-depth`.
pub fn project_dto(value: &Value, max_depth: usize) -> Result<(), Violation> {
    project_node(value, 0, max_depth, "$")
}

fn project_node(
    value: &Value,
    depth: usize,
    max_depth: usize,
    path: &str,
) -> Result<(), Violation> {
    match value {
        Value::Array(items) => {
            if depth > max_depth {
                return Err(depth_violation(max_depth, path));
            }
            for (index, item) in items.iter().enumerate() {
                project_node(item, depth + 1, max_depth, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        Value::Object(entries) => {
            if depth > max_depth {
                return Err(depth_violation(max_depth, path));
            }
            for (key, item) in entries {
                if RESERVED_KEYS.contains(&key.as_str()) {
                    return Err(Violation::new(
                        "dto-key",
                        format!("reserved property name \"{key}\" at {path}"),
                    ));
                }
                project_node(item, depth + 1, max_depth, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn depth_violation(max_depth: usize, path: &str) -> Violation {
    Violation::new(
        "dto-depth",
        format!("nesting exceeds {max_depth} at {path}"),
    )
}

/// One decoded wire frame: the raw body plus its parsed value.
#[derive(Debug, Clone)]
pub struct Frame {
    /// The body bytes exactly as they arrived.
    pub raw: Vec<u8>,
    /// The parsed, checked value.
    pub value: Value,
}

/// Streaming decoder for length-prefixed JSON frames.
#[derive(Debug)]
pub struct FrameDecoder {
    max_frame_bytes: usize,
    max_depth: usize,
    buffer: Vec<u8>,
    failure: Option<Violation>,
}

impl FrameDecoder {
    /// Create a decoder bounded by `max_frame_bytes` and `max_depth`.
    pub fn new(max_frame_bytes: usize, max_depth: usize) -> Self {
        Self {
            max_frame_bytes,
            max_depth,
            buffer: Vec::new(),
            failure: None,
        }
    }

    /// Bytes held back waiting for the rest of a frame.
    pub fn buffered(&self) -> usize {
        self.buffer.len()
    }

    /// Feed raw bytes and take the frames that completed, in order.
    ///
    /// # Errors
    /// Any violation is returned once and then latched: later calls fail with
    /// `decoder-poisoned`.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Frame>, Violation> {
        if let Some(failure) = &self.failure {
            return Err(Violation::new(
                "decoder-poisoned",
                format!(
                    "decoder failed earlier ({}) and accepts no further input",
                    failure.code
                ),
            ));
        }
        match self.push_inner(chunk) {
            Ok(frames) => Ok(frames),
            Err(violation) => {
                self.failure = Some(violation.clone());
                self.buffer = Vec::new();
                Err(violation)
            }
        }
    }

    fn push_inner(&mut self, chunk: &[u8]) -> Result<Vec<Frame>, Violation> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        let mut offset = 0usize;

        while self.buffer.len() - offset >= FRAME_HEADER_BYTES {
            let header: [u8; FRAME_HEADER_BYTES] = self.buffer[offset..offset + FRAME_HEADER_BYTES]
                .try_into()
                .expect("slice length checked above");
            let length = u32::from_be_bytes(header) as usize;
            if length == 0 {
                return Err(Violation::new(
                    "frame-malformed",
                    "frame length must be non-zero",
                ));
            }
            if length > self.max_frame_bytes {
                return Err(Violation::new(
                    "frame-oversized",
                    format!(
                        "frame declares {length} bytes, ceiling is {}",
                        self.max_frame_bytes
                    ),
                ));
            }
            let end = offset + FRAME_HEADER_BYTES + length;
            if self.buffer.len() < end {
                break;
            }
            let body = &self.buffer[offset + FRAME_HEADER_BYTES..end];
            let value = decode_body(body, self.max_depth)?;
            frames.push(Frame {
                raw: body.to_vec(),
                value,
            });
            offset = end;
        }

        if offset > 0 {
            self.buffer.drain(..offset);
        }
        if self.buffer.len() > self.max_frame_bytes + FRAME_HEADER_BYTES {
            return Err(Violation::new(
                "frame-oversized",
                format!(
                    "buffered {} bytes without a complete frame",
                    self.buffer.len()
                ),
            ));
        }
        Ok(frames)
    }
}
