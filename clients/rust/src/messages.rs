//! Wire messages: typed builders for what an adapter sends, checked parsers
//! for what it receives.
//!
//! The adapter pushes commits, the driver issues requests, and either side may
//! send an error and close. Everything is validated against the active limits
//! before it is retained; failures are returned, never raised.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::ParseError;
use crate::framing::project_dto;
use crate::limits::Limits;
use crate::logs::{validate_log_record, LogRecord};
use crate::marker::MAX_SAFE_INTEGER;
use crate::roles::{valid_capability, Capability, ADAPTER_CAPABILITIES};
use crate::tree::Snapshot;
use crate::validate::{validate_snapshot, validate_tree_delta};

/// The wire protocol identifier both sides must agree on.
pub const PROTOCOL_ID: &str = "termwright/1";

/// The current major version.
pub const PROTOCOL_VERSION: u8 = 1;

/// Longest token, identifier or free-text message accepted.
const MAX_IDENTIFIER_LENGTH: usize = 1024;

const ERROR_CODES: [&str; 5] = [
    "bad-token",
    "bad-version",
    "malformed",
    "limit-exceeded",
    "internal",
];

const LIMIT_FIELDS: [&str; 11] = [
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
];

/// Identifies the adapter implementation to the driver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterInfo {
    /// Accessible name; empty when the node has none.
    pub name: String,
    /// Adapter version string.
    pub version: String,
}

/// The adapter's handshake: sent exactly once, before anything else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: String,
    /// Protocol identifier; must be `termwright/1`.
    pub protocol: String,
    /// Per-launch session token from the environment.
    pub token: String,
    /// Adapter name and version.
    pub adapter: AdapterInfo,
    /// What this adapter can provide.
    pub capabilities: Vec<Capability>,
    /// Present when the sender is a probe rather than a hand-written adapter.
    ///
    /// Carries what the probe can actually observe — framework and versions,
    /// the best identity it can produce, and its optional abilities — so the
    /// driver negotiates against measured capability rather than a floor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<ProbeInfo>,
}

/// How an object's identity behaves across frames.
///
/// `FrameLocal` is a legitimate answer, not a degraded one: in immediate mode
/// the widget is consumed by the render and nothing survives to be named
/// again. A consumer must not correlate frame-local values between frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProbeIdentityKind {
    /// Identities survive across frames and may be correlated.
    Stable,
    /// Identities are meaningful only within their own frame.
    FrameLocal,
}

/// What a probe says about itself when it attaches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    /// Framework name, e.g. `ratatui`.
    pub framework: String,
    /// Version of the framework, when the probe can determine it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework_version: Option<String>,
    /// Version of the probe itself, so a mismatch is diagnosable.
    pub probe_version: String,
    /// The best identity this probe can offer for any object.
    pub identity_kind: ProbeIdentityKind,
    /// Optional abilities, from the protocol's closed set.
    pub capabilities: Vec<String>,
}

impl Hello {
    /// Build a handshake for this adapter.
    pub fn new(token: &str, name: &str, version: &str, capabilities: Vec<Capability>) -> Self {
        Self {
            kind: "hello".into(),
            protocol: PROTOCOL_ID.into(),
            token: token.to_owned(),
            adapter: AdapterInfo {
                name: name.to_owned(),
                version: version.to_owned(),
            },
            capabilities,
            probe: None,
        }
    }

    /// Attach a probe's declaration to this handshake.
    #[must_use]
    pub fn with_probe(mut self, probe: ProbeInfo) -> Self {
        self.probe = Some(probe);
        self
    }
}

/// Whether the adapter should emit render markers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkerConfig {
    /// Whether the adapter should emit render markers.
    pub enabled: bool,
}

/// The log-channel allowance, sent only when the adapter announced the `logs`
/// capability. Absent means logs are disabled: an adapter that receives no
/// budget must not emit log messages at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBudget {
    /// Whether the driver wants log records at all.
    pub enabled: bool,
    /// Sustained ceiling on records per second.
    pub max_records_per_second: i64,
    /// Records allowed in a burst on top of the sustained rate.
    pub burst: i64,
}

/// The driver's reply: session id, negotiated limits, what to push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloAck {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: String,
    /// Protocol identifier; must be `termwright/1`.
    pub protocol: String,
    /// Session this snapshot belongs to.
    pub session_id: String,
    /// Ceilings the driver imposes for this session.
    pub limits: Limits,
    /// What the driver wants pushed: snapshots or revisions.
    pub subscribe: String,
    /// Whether render markers are wanted.
    pub marker: MarkerConfig,
    /// Log-channel budget; `None` means logs are disabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logs: Option<LogBudget>,
}

/// Announces that a render was committed to the terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionCommit {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Render revision, strictly increasing per session.
    pub revision: i64,
}

impl RevisionCommit {
    /// Commit `revision`.
    pub fn new(revision: i64) -> Self {
        Self {
            kind: "revision-commit",
            revision,
        }
    }
}

/// Carries a full tree for one revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SnapshotMessage<'a> {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// The tree being carried.
    pub snapshot: &'a Snapshot,
}

impl<'a> SnapshotMessage<'a> {
    /// Wrap a snapshot in its envelope.
    pub fn new(snapshot: &'a Snapshot) -> Self {
        Self {
            kind: "snapshot",
            snapshot,
        }
    }
}

/// The driver asking for a tree: the latest, or a held revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTree {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: String,
    /// Correlates a request with its answer.
    pub request_id: i64,
    /// Render revision, strictly increasing per session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<i64>,
}

/// Answers a [`GetTree`] with exactly one of a snapshot or an error.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTreeResult {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Correlates a request with its answer.
    pub request_id: i64,
    /// The tree being carried.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Box<serde_json::value::RawValue>>,
    /// Why the request could not be answered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl GetTreeResult {
    /// Answer with a retained snapshot body.
    pub fn found(request_id: i64, snapshot: Box<serde_json::value::RawValue>) -> Self {
        Self {
            kind: "get-tree-result",
            request_id,
            snapshot: Some(snapshot),
            error: None,
        }
    }

    /// Answer that the requested revision is not available.
    pub fn missing(request_id: i64, detail: impl Into<String>) -> Self {
        Self {
            kind: "get-tree-result",
            request_id,
            snapshot: None,
            error: Some(detail.into()),
        }
    }
}

/// Carries one application log record to the driver.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LogMessage<'a> {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// The record.
    pub record: &'a LogRecord,
}

impl<'a> LogMessage<'a> {
    /// Wrap a record in its envelope.
    pub fn new(record: &'a LogRecord) -> Self {
        Self {
            kind: "log",
            record,
        }
    }
}

/// Terminal error: the sender closes after emitting it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolErrorMessage {
    /// Wire discriminator (`type` on the wire).
    #[serde(rename = "type")]
    pub kind: String,
    /// One of the five wire error codes.
    pub code: String,
    /// Human-readable detail; never carries the token.
    pub message: String,
}

impl ProtocolErrorMessage {
    /// Build an error message with one of the five wire codes.
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            kind: "error".into(),
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

/// Every capability a tree-publishing adapter with real bounds announces.
pub fn default_capabilities() -> Vec<Capability> {
    vec![
        Capability::Tree,
        Capability::Bounds,
        Capability::AbsoluteBounds,
        Capability::States,
        Capability::Actions,
        Capability::RenderRevisions,
    ]
}

// -- parsing ---------------------------------------------------------------

fn project(value: &Value, limits: &Limits) -> Result<(), ParseError> {
    project_dto(value, limits.max_depth).map_err(|violation| {
        if violation.code == "dto-depth" {
            ParseError::new("limit-exceeded", violation.to_string())
        } else {
            ParseError::malformed(violation.to_string())
        }
    })
}

fn as_message<'a>(value: &'a Value) -> Result<(&'a Map<String, Value>, &'a str), ParseError> {
    let object = value
        .as_object()
        .ok_or_else(|| ParseError::malformed("unknown or missing message type"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::malformed("unknown or missing message type"))?;
    Ok((object, kind))
}

/// Check that every required key is present, tolerating unknown ones.
fn required_keys(object: &Map<String, Value>, required: &[&str]) -> Result<(), ParseError> {
    for key in required {
        if !object.contains_key(*key) {
            return Err(ParseError::malformed(format!("missing field \"{key}\"")));
        }
    }
    Ok(())
}

fn require_keys(
    object: &Map<String, Value>,
    required: &[&str],
    optional: &[&str],
) -> Result<(), ParseError> {
    for key in required {
        if !object.contains_key(*key) {
            return Err(ParseError::malformed(format!("missing field \"{key}\"")));
        }
    }
    for key in object.keys() {
        if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
            return Err(ParseError::malformed(format!("unrecognized key \"{key}\"")));
        }
    }
    Ok(())
}

fn identifier(object: &Map<String, Value>, key: &str, allow_empty: bool) -> Result<(), ParseError> {
    let Some(text) = object.get(key).and_then(Value::as_str) else {
        return Err(ParseError::malformed(format!("{key}: expected a string")));
    };
    if text.len() > MAX_IDENTIFIER_LENGTH {
        return Err(ParseError::malformed(format!(
            "{key}: expected at most {MAX_IDENTIFIER_LENGTH} characters"
        )));
    }
    if !allow_empty && text.is_empty() {
        return Err(ParseError::malformed(format!(
            "{key}: expected a non-empty string"
        )));
    }
    Ok(())
}

fn whole_number(object: &Map<String, Value>, key: &str, positive: bool) -> Result<(), ParseError> {
    let number = object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|n| n.abs() <= MAX_SAFE_INTEGER);
    match number {
        Some(number) if positive && number > 0 => Ok(()),
        Some(number) if !positive && number >= 0 => Ok(()),
        _ if positive => Err(ParseError::malformed(format!(
            "{key}: expected a positive safe integer"
        ))),
        _ => Err(ParseError::malformed(format!(
            "{key}: expected a non-negative safe integer"
        ))),
    }
}

fn check_embedded_snapshot(value: &Value, limits: &Limits) -> Result<(), ParseError> {
    match validate_snapshot(value, limits) {
        Ok(()) => Ok(()),
        Err(error) => {
            let code = match error.code {
                "bytes" | "count" | "depth" | "string-bytes" => "limit-exceeded",
                _ => "malformed",
            };
            Err(ParseError::new(code, format!("snapshot {error}")))
        }
    }
}

/// Validate the optional log-channel budget carried by `hello-ack`.
fn check_log_budget(value: &Value) -> Result<(), ParseError> {
    let budget = value
        .as_object()
        .ok_or_else(|| ParseError::malformed("logs: expected an object"))?;
    required_keys(budget, &["enabled", "maxRecordsPerSecond", "burst"])?;
    if !budget["enabled"].is_boolean() {
        return Err(ParseError::malformed("logs.enabled: expected a boolean"));
    }
    whole_number(budget, "maxRecordsPerSecond", true)?;
    whole_number(budget, "burst", false)
}

fn check_error_message(object: &Map<String, Value>, strict: bool) -> Result<(), ParseError> {
    if strict {
        require_keys(object, &["type", "code", "message"], &[])?;
    } else {
        required_keys(object, &["type", "code", "message"])?;
    }
    let code = object
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !ERROR_CODES.contains(&code) {
        return Err(ParseError::malformed("code: unknown error code"));
    }
    identifier(object, "message", true)
}

fn check_protocol_field(object: &Map<String, Value>) -> Result<(), ParseError> {
    match object.get("protocol").and_then(Value::as_str) {
        Some(protocol) if protocol != PROTOCOL_ID => Err(ParseError::new(
            "bad-version",
            format!("unsupported protocol {protocol}"),
        )),
        _ => Ok(()),
    }
}

/// Validate one adapter → driver message.
///
/// Strict: an unknown field from an adapter is a protocol error, not an
/// extension. See [`parse_driver_message`] for the other direction.
///
/// # Errors
/// Returns a [`ParseError`] whose `code` is `bad-version`, `malformed` or
/// `limit-exceeded`.
pub fn parse_adapter_message(value: &Value, limits: &Limits) -> Result<(), ParseError> {
    project(value, limits)?;
    let (object, kind) = as_message(value)?;

    match kind {
        "hello" => {
            check_protocol_field(object)?;
            require_keys(
                object,
                &["type", "protocol", "token", "adapter", "capabilities"],
                &[],
            )?;
            identifier(object, "token", false)?;
            let adapter = object
                .get("adapter")
                .and_then(Value::as_object)
                .ok_or_else(|| ParseError::malformed("adapter: expected an object"))?;
            require_keys(adapter, &["name", "version"], &[])?;
            identifier(adapter, "name", false)?;
            identifier(adapter, "version", false)?;
            let capabilities = object
                .get("capabilities")
                .and_then(Value::as_array)
                .ok_or_else(|| ParseError::malformed("capabilities: expected an array"))?;
            if capabilities.len() > ADAPTER_CAPABILITIES.len() {
                return Err(ParseError::malformed("capabilities: too many entries"));
            }
            for item in capabilities {
                match item.as_str() {
                    Some(name) if valid_capability(name) => {}
                    _ => return Err(ParseError::malformed("capabilities: unknown capability")),
                }
            }
            Ok(())
        }
        "revision-commit" => {
            require_keys(object, &["type", "revision"], &[])?;
            whole_number(object, "revision", true)
        }
        "snapshot" => {
            require_keys(object, &["type", "snapshot"], &[])?;
            check_embedded_snapshot(&object["snapshot"], limits)
        }
        "get-tree-result" => {
            require_keys(object, &["type", "requestId"], &["snapshot", "error"])?;
            whole_number(object, "requestId", false)?;
            let has_snapshot = object.contains_key("snapshot");
            let has_error = object.contains_key("error");
            if has_snapshot == has_error {
                return Err(ParseError::malformed(
                    "exactly one of snapshot or error must be present",
                ));
            }
            if has_error {
                return identifier(object, "error", true);
            }
            check_embedded_snapshot(&object["snapshot"], limits)
        }
        "tree-delta" => match validate_tree_delta(value, limits) {
            Ok(()) => Ok(()),
            Err(error) => {
                let code = match error.code {
                    "bytes" | "count" | "depth" | "string-bytes" => "limit-exceeded",
                    _ => "malformed",
                };
                Err(ParseError::new(code, format!("tree-delta {error}")))
            }
        },
        "log" => {
            require_keys(object, &["type", "record"], &[])?;
            check_embedded_log_record(&object["record"], limits)
        }
        "error" => check_error_message(object, true),
        _ => Err(ParseError::malformed("unknown or missing message type")),
    }
}

/// Map a record failure onto the wire taxonomy: capacity failures are
/// `limit-exceeded`, the rest are `malformed`.
fn check_embedded_log_record(value: &Value, limits: &Limits) -> Result<(), ParseError> {
    match validate_log_record(value, limits) {
        Ok(()) => Ok(()),
        Err(error) => {
            let code = match error.code {
                "bytes" | "count" | "depth" | "string-bytes" => "limit-exceeded",
                _ => "malformed",
            };
            Err(ParseError::new(code, format!("log record {error}")))
        }
    }
}

/// Validate one driver → adapter message.
///
/// Driver traffic is read tolerantly: unknown fields in the envelope and in
/// the driver's nested objects (`marker`, `logs`, `limits`) are ignored and
/// passed through to the caller, so a newer driver can add a field without
/// breaking an adapter published before it existed.
///
/// The asymmetry is about who is speaking, not about the message: adapter
/// traffic crosses an untrusted boundary, where an unknown field is a signal
/// rather than an extension. Tolerance is not leniency either — known fields
/// keep their types, and the closed sets (message types, error codes,
/// `subscribe`, roles, actions) stay closed in both directions.
///
/// # Errors
/// Returns a [`ParseError`] whose `code` is `bad-version`, `malformed` or
/// `limit-exceeded`.
pub fn parse_driver_message(value: &Value, limits: &Limits) -> Result<(), ParseError> {
    project(value, limits)?;
    let (object, kind) = as_message(value)?;

    match kind {
        "hello-ack" => {
            check_protocol_field(object)?;
            required_keys(
                object,
                &[
                    "type",
                    "protocol",
                    "sessionId",
                    "limits",
                    "subscribe",
                    "marker",
                ],
            )?;
            identifier(object, "sessionId", false)?;
            let limits_object = object
                .get("limits")
                .and_then(Value::as_object)
                .ok_or_else(|| ParseError::malformed("limits: expected an object"))?;
            // Required keys must all be present, but unknown ones are
            // ignored: see the note on `Limits`.
            required_keys(limits_object, &LIMIT_FIELDS)?;
            for field in LIMIT_FIELDS {
                whole_number(limits_object, field, true)?;
            }
            match object.get("subscribe").and_then(Value::as_str) {
                Some("snapshots") | Some("revisions") | Some("diffs") => {}
                _ => {
                    return Err(ParseError::malformed(
                        "subscribe: expected 'snapshots', 'revisions' or 'diffs'",
                    ))
                }
            }
            let marker = object
                .get("marker")
                .and_then(Value::as_object)
                .ok_or_else(|| ParseError::malformed("marker: expected an object"))?;
            required_keys(marker, &["enabled"])?;
            if !marker["enabled"].is_boolean() {
                return Err(ParseError::malformed("marker.enabled: expected a boolean"));
            }
            if let Some(logs) = object.get("logs") {
                check_log_budget(logs)?;
            }
            Ok(())
        }
        "get-tree" => {
            required_keys(object, &["type", "requestId"])?;
            whole_number(object, "requestId", false)?;
            if object.contains_key("revision") {
                whole_number(object, "revision", true)?;
            }
            Ok(())
        }
        "error" => check_error_message(object, false),
        _ => Err(ParseError::malformed("unknown or missing message type")),
    }
}
