//! Application log records carried over the semantic channel.
//!
//! A TUI cannot print diagnostics to the screen without corrupting the render,
//! so applications write them to a logger instead. The `logs` capability
//! forwards those records to the driver, where they become assertable test
//! state rather than invisible side effects.
//!
//! Records are bounded exactly like snapshots: measured against a byte ceiling
//! and rejected wholesale on any violation, so a misbehaving logger degrades
//! into dropped records rather than unbounded driver memory.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::ValidationError;
use crate::framing::project_dto;
use crate::limits::Limits;
use crate::marker::MAX_SAFE_INTEGER;

/// One rung of the severity ladder.
///
/// The set is closed: it is the intersection of the ladders used by Rust
/// `tracing`, Python `logging`, Go `slog`, pino and winston, so every bridge
/// maps onto it without inventing a level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Finer than debug.
    Trace,
    /// Diagnostic detail.
    Debug,
    /// Ordinary progress.
    Info,
    /// Something recoverable went wrong.
    Warn,
    /// An operation failed.
    Error,
    /// The application cannot continue.
    Fatal,
}

impl LogLevel {
    /// Numeric severity; higher is more severe.
    pub fn severity(self) -> u8 {
        match self {
            LogLevel::Trace => 10,
            LogLevel::Debug => 20,
            LogLevel::Info => 30,
            LogLevel::Warn => 40,
            LogLevel::Error => 50,
            LogLevel::Fatal => 60,
        }
    }

    /// The wire spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Trace => "trace",
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
            LogLevel::Fatal => "fatal",
        }
    }
}

/// The ladder in order, least to most severe.
pub const LOG_LEVELS: [&str; 6] = ["trace", "debug", "info", "warn", "error", "fatal"];

/// Maximum number of attribute keys on one record.
pub const MAX_LOG_ATTRS: usize = 64;

const RECORD_FIELDS: [&str; 7] = [
    "ts", "level", "message", "attrs", "logger", "seq", "revision",
];

/// A structured attribute value. Scalars only: nested values make a record's
/// size unbounded and depth-dependent, so bridges flatten before they send.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AttrValue {
    /// Absent or explicitly empty.
    Null,
    /// A flag.
    Bool(bool),
    /// An integer.
    Int(i64),
    /// A finite float.
    Float(f64),
    /// Text.
    Text(String),
}

impl From<bool> for AttrValue {
    fn from(value: bool) -> Self {
        AttrValue::Bool(value)
    }
}

impl From<i64> for AttrValue {
    fn from(value: i64) -> Self {
        AttrValue::Int(value)
    }
}

impl From<u64> for AttrValue {
    fn from(value: u64) -> Self {
        AttrValue::Int(value as i64)
    }
}

impl From<f64> for AttrValue {
    fn from(value: f64) -> Self {
        if value.is_finite() {
            AttrValue::Float(value)
        } else {
            AttrValue::Text(value.to_string())
        }
    }
}

impl From<&str> for AttrValue {
    fn from(value: &str) -> Self {
        AttrValue::Text(value.to_owned())
    }
}

impl From<String> for AttrValue {
    fn from(value: String) -> Self {
        AttrValue::Text(value)
    }
}

/// One application log record.
///
/// `ts` is Unix epoch milliseconds, not session-relative: an adapter has no
/// reliable view of when the driver considers the session to have started, so
/// the wall clock is the only clock both sides agree on without negotiating.
/// The driver rebases it onto the session timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogRecord {
    /// Unix epoch milliseconds when the record was produced.
    pub ts: i64,
    /// Severity.
    pub level: LogLevel,
    /// Human-readable message, already formatted by the source logger.
    pub message: String,
    /// Flat structured context; sorted so a record serialises the same way twice.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attrs: BTreeMap<String, AttrValue>,
    /// Logger or channel name, e.g. `http` or `db.pool`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logger: Option<String>,
    /// Per-session counter assigned by the adapter. A gap tells the driver
    /// records were dropped upstream rather than lost in transit.
    pub seq: i64,
    /// Semantic revision current when the record was produced, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<i64>,
}

impl LogRecord {
    /// A record with only the required fields. `seq` is assigned by the client.
    pub fn new(level: LogLevel, message: impl Into<String>) -> Self {
        Self {
            ts: 0,
            level,
            message: message.into(),
            attrs: BTreeMap::new(),
            logger: None,
            seq: 0,
            revision: None,
        }
    }

    /// Add one flat attribute.
    pub fn with_attr(mut self, key: impl Into<String>, value: impl Into<AttrValue>) -> Self {
        self.attrs.insert(key.into(), value.into());
        self
    }

    /// Name the logger this record came from.
    pub fn with_logger(mut self, logger: impl Into<String>) -> Self {
        self.logger = Some(logger.into());
        self
    }

    /// Validate against `limits`, as the driver will.
    ///
    /// # Errors
    /// Returns a [`ValidationError`] with the shared taxonomy.
    pub fn validate(&self, limits: &Limits) -> Result<(), ValidationError> {
        let value = serde_json::to_value(self)
            .map_err(|_| ValidationError::new("schema", "log record is not JSON-serialisable"))?;
        validate_log_record(&value, limits)
    }
}

fn fail(code: &'static str, detail: impl Into<String>) -> ValidationError {
    ValidationError::new(code, detail)
}

fn safe_non_negative(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .filter(|number| *number >= 0 && *number <= MAX_SAFE_INTEGER)
}

/// Validate an untrusted log record against `limits`.
///
/// Mirrors [`crate::validate_snapshot`]: projected first, then measured
/// against `max_log_record_bytes`, then checked field by field. Never panics.
///
/// # Errors
/// Returns a [`ValidationError`] whose `code` matches the reference
/// implementation's.
pub fn validate_log_record(value: &Value, limits: &Limits) -> Result<(), ValidationError> {
    if let Err(violation) = project_dto(value, limits.max_depth) {
        let code = if violation.code == "dto-depth" {
            "depth"
        } else {
            "schema"
        };
        return Err(fail(code, violation.to_string()));
    }

    let serialised = serde_json::to_vec(value)
        .map_err(|_| fail("schema", "log record is not JSON-serialisable"))?;
    if serialised.len() > limits.max_log_record_bytes {
        return Err(fail(
            "bytes",
            format!(
                "log record is {} bytes, ceiling is {}",
                serialised.len(),
                limits.max_log_record_bytes
            ),
        ));
    }

    let Some(record) = value.as_object() else {
        return Err(fail("schema", "log record must be an object"));
    };

    for key in record.keys() {
        if !RECORD_FIELDS.contains(&key.as_str()) {
            return Err(fail(
                "schema",
                format!("unknown log record property \"{key}\""),
            ));
        }
    }

    match safe_non_negative(record.get("ts")) {
        Some(ts) if ts > 0 => {}
        _ => {
            return Err(fail(
                "schema",
                "ts must be a positive safe integer (epoch milliseconds)",
            ))
        }
    }
    match record.get("level").and_then(Value::as_str) {
        Some(level) if LOG_LEVELS.contains(&level) => {}
        _ => {
            return Err(fail(
                "schema",
                format!("level must be one of {}", LOG_LEVELS.join(", ")),
            ))
        }
    }
    let Some(message) = record.get("message").and_then(Value::as_str) else {
        return Err(fail("schema", "message must be a string"));
    };
    if message.len() > limits.max_string_bytes {
        return Err(fail(
            "string-bytes",
            format!("message exceeds {} UTF-8 bytes", limits.max_string_bytes),
        ));
    }
    if safe_non_negative(record.get("seq")).is_none() {
        return Err(fail("schema", "seq must be a non-negative safe integer"));
    }

    if let Some(logger) = record.get("logger") {
        let Some(text) = logger.as_str() else {
            return Err(fail("schema", "logger must be a string"));
        };
        if text.len() > limits.max_string_bytes {
            return Err(fail(
                "string-bytes",
                format!("logger exceeds {} UTF-8 bytes", limits.max_string_bytes),
            ));
        }
    }

    if let Some(revision) = record.get("revision") {
        match safe_non_negative(Some(revision)) {
            Some(value) if value > 0 => {}
            _ => return Err(fail("revision", "revision must be a positive safe integer")),
        }
    }

    if let Some(attrs) = record.get("attrs") {
        let Some(attrs) = attrs.as_object() else {
            return Err(fail("schema", "attrs must be a flat object"));
        };
        if attrs.len() > MAX_LOG_ATTRS {
            return Err(fail(
                "count",
                format!(
                    "attrs carries {} keys, ceiling is {MAX_LOG_ATTRS}",
                    attrs.len()
                ),
            ));
        }
        for (key, attr) in attrs {
            if key.len() > limits.max_string_bytes {
                return Err(fail(
                    "string-bytes",
                    format!("attribute key \"{key}\" exceeds the string ceiling"),
                ));
            }
            match attr {
                Value::Null | Value::Bool(_) => {}
                Value::Number(number) => {
                    if number.as_f64().is_none_or(|value| !value.is_finite()) {
                        return Err(fail(
                            "schema",
                            format!("attribute \"{key}\" must be a finite number"),
                        ));
                    }
                }
                Value::String(text) => {
                    if text.len() > limits.max_string_bytes {
                        return Err(fail(
                            "string-bytes",
                            format!("attribute \"{key}\" exceeds the string ceiling"),
                        ));
                    }
                }
                _ => {
                    return Err(fail(
                        "schema",
                        format!("attribute \"{key}\" must be a string, number, boolean or null"),
                    ))
                }
            }
        }
    }

    Ok(())
}
