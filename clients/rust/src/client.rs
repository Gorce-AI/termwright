//! Blocking unix-socket client for the semantic side-channel.
//!
//! **Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in
//! the environment [`Client::from_env`] returns `None`: the application opens
//! no socket, writes no marker, and renders exactly the bytes it would have
//! rendered anyway.
//!
//! The client is deliberately blocking and single-threaded. A TUI renders on
//! one thread and the marker must follow that render's last byte, so
//! [`Client::publish`] does its socket work inline and hands back the marker
//! to write. Driver requests are picked up by [`Client::poll`], which never
//! blocks.

use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::value::RawValue;
use serde_json::Value;

use crate::debug::{describe_endpoint, error_label, join_capabilities, on_off, Category, DebugLog};
use crate::diffing::build_delta;
use crate::error::Error;
use crate::framing::{encode_frame, FrameDecoder};
use crate::limits::{Limits, DEFAULT_LIMITS};
use crate::logs::{AttrValue, LogLevel, LogRecord, MAX_LOG_ATTRS};
use crate::marker::encode_marker;
use crate::messages::{
    default_capabilities, parse_driver_message, GetTree, GetTreeResult, Hello, HelloAck,
    LogMessage, ProbeInfo, ProtocolErrorMessage, RevisionCommit, SnapshotMessage,
};
use crate::roles::Capability;
use crate::tree::Snapshot;
use crate::validate::validate_snapshot;

/// Environment variable naming the driver's socket.
pub const ENV_ENDPOINT: &str = "TERMWRIGHT_ENDPOINT";
/// Environment variable carrying the per-launch session token.
pub const ENV_TOKEN: &str = "TERMWRIGHT_TOKEN";
/// Environment variable pinning the protocol version.
pub const ENV_PROTOCOL: &str = "TERMWRIGHT_PROTOCOL";

/// Default handshake budget.
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(5);

/// Default bound on a single frame write.
///
/// This client is blocking by design — a TUI renders on one thread and the
/// marker must follow that render's last byte — so an unbounded `write_all`
/// turns a driver that stopped reading into an application that stopped
/// drawing. A driver that cannot take a frame in a quarter of a second is not
/// keeping up, and the next frame carries newer state anyway.
pub const WRITE_TIMEOUT: Duration = Duration::from_millis(250);

/// How many recent revisions stay answerable by `get-tree`.
const SNAPSHOT_HISTORY: usize = 8;

/// How a client identifies itself and what it can provide.
#[derive(Debug, Clone)]
pub struct Options {
    /// Adapter name sent in the handshake.
    pub adapter_name: String,
    /// Adapter version sent in the handshake.
    pub adapter_version: String,
    /// Capabilities announced to the driver.
    pub capabilities: Vec<Capability>,
    /// Limits in force until `hello-ack` replaces them.
    pub limits: Limits,
    /// Bound on a single frame write. `None` disables it, which is only sane
    /// for a caller that publishes off the render path.
    pub write_timeout: Option<Duration>,
    /// What a probe says it can observe. `None` for a hand-written adapter,
    /// which is what the driver assumes by default.
    pub probe: Option<ProbeInfo>,
    /// Adapter-side diagnostic log, or `None` for silence — which is what
    /// [`Options::new`] leaves here unless `TERMWRIGHT_DEBUG_FILE` names a
    /// file. Shared rather than owned so an adapter can log alongside the
    /// client on the same file.
    pub debug: Option<Arc<DebugLog>>,
}

impl Options {
    /// Options for an adapter that also forwards application logs.
    ///
    /// Announcing `logs` is what makes the driver grant a budget; without it
    /// the driver sends none and the adapter must stay silent.
    pub fn with_logs(adapter_name: impl Into<String>, adapter_version: impl Into<String>) -> Self {
        let mut options = Self::new(adapter_name, adapter_version);
        options.capabilities.push(Capability::Logs);
        options
    }

    /// Options for an adapter with the default capability set.
    pub fn new(adapter_name: impl Into<String>, adapter_version: impl Into<String>) -> Self {
        Self {
            adapter_name: adapter_name.into(),
            adapter_version: adapter_version.into(),
            capabilities: default_capabilities(),
            limits: DEFAULT_LIMITS,
            write_timeout: Some(WRITE_TIMEOUT),
            probe: None,
            // Left silent on purpose: opening a file is a side effect, and a
            // constructor is the wrong place for one. `Client::from_env` is
            // where the environment is read, here and in the other clients.
            debug: None,
        }
    }
}

/// Wall-clock milliseconds, the only clock both sides agree on without
/// negotiating: an adapter cannot know when the driver opened the session.
fn epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Rate limiter for the log channel: `burst` capacity on top of the sustained
/// rate, refilled continuously.
///
/// The adapter enforces its own budget and drops locally, which is what keeps
/// a log storm from eating the frame budget the semantic tree needs.
#[derive(Debug)]
struct TokenBucket {
    per_second: f64,
    capacity: f64,
    tokens: f64,
    updated: Instant,
}

impl TokenBucket {
    fn new(per_second: i64, burst: i64, now: Instant) -> Self {
        let rate = per_second.max(0) as f64;
        let capacity = rate + burst.max(0) as f64;
        Self {
            per_second: rate,
            capacity,
            tokens: capacity,
            updated: now,
        }
    }

    /// Consume one token, refilling first. `false` means "over budget".
    fn take(&mut self, now: Instant) -> bool {
        if self.per_second <= 0.0 {
            return false;
        }
        let elapsed = now.saturating_duration_since(self.updated).as_secs_f64();
        self.updated = now;
        self.tokens = (self.tokens + elapsed * self.per_second).min(self.capacity);
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

/// One semantic session: handshake, snapshot publishing, render markers.
///
/// The client owns the revision counter; an adapter never picks its own.
#[derive(Debug)]
pub struct Client {
    endpoint: String,
    token: String,
    options: Options,

    stream: Option<UnixStream>,
    decoder: FrameDecoder,
    limits: Limits,
    session_id: Option<String>,
    revision: i64,
    marker_enabled: bool,
    log_budget: Option<crate::messages::LogBudget>,
    published: Option<Value>,
    deltas_sent: u64,
    snapshots_sent: u64,
    log_seq: i64,
    log_bucket: Option<TokenBucket>,
    logs_dropped: u64,
    subscribe: String,
    history: VecDeque<(i64, Box<RawValue>)>,
    force_full: bool,
}

impl Client {
    /// Build a client for an explicit endpoint and token.
    pub fn new(endpoint: impl Into<String>, token: impl Into<String>, options: Options) -> Self {
        let limits = options.limits;
        Self {
            endpoint: endpoint.into(),
            token: token.into(),
            options,
            stream: None,
            decoder: FrameDecoder::new(limits.max_frame_bytes, limits.max_depth),
            limits,
            session_id: None,
            revision: 0,
            marker_enabled: false,
            log_budget: None,
            published: None,
            deltas_sent: 0,
            snapshots_sent: 0,
            log_seq: 0,
            log_bucket: None,
            logs_dropped: 0,
            subscribe: "snapshots".to_owned(),
            history: VecDeque::new(),
            force_full: false,
        }
    }

    /// Build a client from `TERMWRIGHT_*`, or `None` when not instrumented.
    ///
    /// This is the dormant rule in one function: no endpoint or no token means
    /// no client, and the caller must then open nothing and emit nothing.
    pub fn from_env(mut options: Options) -> Option<Self> {
        if options.debug.is_none() {
            options.debug = DebugLog::from_env(&options.adapter_name).map(Arc::new);
        }
        Self::from_values(
            std::env::var(ENV_ENDPOINT).ok().as_deref(),
            std::env::var(ENV_TOKEN).ok().as_deref(),
            std::env::var(ENV_PROTOCOL).ok().as_deref(),
            options,
        )
    }

    /// Build a client from explicit endpoint, token and protocol values,
    /// applying the same dormant rule as [`Client::from_env`].
    ///
    /// Use this when the process manages its own environment, or in tests.
    /// A missing or empty endpoint or token, a protocol other than
    /// `termwright/1`, or a Windows named pipe all yield `None`.
    pub fn from_values(
        endpoint: Option<&str>,
        token: Option<&str>,
        protocol: Option<&str>,
        options: Options,
    ) -> Option<Self> {
        let endpoint = endpoint.filter(|value| !value.is_empty());
        let token = token.filter(|value| !value.is_empty());
        let (Some(endpoint), Some(token)) = (endpoint, token) else {
            if let Some(log) = options.debug.as_ref() {
                let mut missing = Vec::new();
                if endpoint.is_none() {
                    missing.push(ENV_ENDPOINT);
                }
                if token.is_none() {
                    missing.push(ENV_TOKEN);
                }
                log.line(
                    Category::Diag,
                    &format!("dormant: {} not set", missing.join(" and ")),
                );
            }
            return None;
        };
        if let Some(protocol) = protocol.filter(|value| !value.is_empty()) {
            if protocol != crate::messages::PROTOCOL_ID && protocol != "1" {
                if let Some(log) = options.debug.as_ref() {
                    log.line(
                        Category::Diag,
                        &format!(
                            "dormant: {ENV_PROTOCOL}={protocol:?} is not {:?}",
                            crate::messages::PROTOCOL_ID
                        ),
                    );
                }
                return None;
            }
        }
        if endpoint.starts_with(r"\\.\pipe\") || endpoint.starts_with(r"\\?\pipe\") {
            // Named pipes need a Windows-only transport; stay dormant rather
            // than half-working.
            if let Some(log) = options.debug.as_ref() {
                log.line(
                    Category::Diag,
                    &format!(
                        "dormant: {} needs a Windows transport this client does not have",
                        describe_endpoint(endpoint)
                    ),
                );
            }
            return None;
        }
        Some(Self::new(endpoint, token, options))
    }

    /// Connect, send `hello`, and wait for `hello-ack`.
    ///
    /// # Errors
    /// Returns [`Error::Io`] when the endpoint is unreachable and
    /// [`Error::HandshakeTimeout`] when the driver does not answer. A failed
    /// side-channel must not take the application down: callers are expected
    /// to carry on rendering.
    pub fn connect(&mut self, timeout: Duration) -> Result<(), Error> {
        self.debug_line(
            Category::Sem,
            &format!(
                "dial {} timeout={}ms",
                describe_endpoint(&self.endpoint),
                timeout.as_millis()
            ),
        );
        let stream = match UnixStream::connect(&self.endpoint) {
            Ok(stream) => stream,
            Err(error) => {
                self.debug_line(
                    Category::Diag,
                    &format!("dial failed, staying dormant: {}", error_label(&error)),
                );
                return Err(error.into());
            }
        };
        stream.set_read_timeout(Some(Duration::from_millis(50)))?;
        stream.set_write_timeout(self.options.write_timeout)?;
        self.stream = Some(stream);

        let mut hello = Hello::new(
            &self.token,
            &self.options.adapter_name,
            &self.options.adapter_version,
            self.options.capabilities.clone(),
        );
        if let Some(probe) = self.options.probe.clone() {
            hello = hello.with_probe(probe);
        }
        self.send(&hello)?;
        self.debug_line(
            Category::Sem,
            &format!(
                "hello sent adapter={}/{} caps={}",
                self.options.adapter_name,
                self.options.adapter_version,
                join_capabilities(&self.options.capabilities)
            ),
        );

        let deadline = Instant::now() + timeout;
        while self.session_id.is_none() {
            if Instant::now() >= deadline {
                self.debug_line(
                    Category::Diag,
                    &format!(
                        "no hello-ack within {}ms, staying dormant",
                        timeout.as_millis()
                    ),
                );
                self.close();
                return Err(Error::HandshakeTimeout);
            }
            self.poll()?;
        }
        Ok(())
    }

    /// Write one diagnostic line, when diagnostics are on.
    ///
    /// Named apart from [`Client::log`], which is the application's own log
    /// channel to the driver: these two go to different places for different
    /// readers, and confusing them would put application text in a CI artifact
    /// or diagnostics on the wire.
    fn debug_line(&self, category: Category, message: &str) {
        if let Some(log) = self.options.debug.as_ref() {
            log.line(category, message);
        }
    }

    /// Whether the handshake completed and the link is still up.
    pub fn connected(&self) -> bool {
        self.session_id.is_some() && self.stream.is_some()
    }

    /// The id the driver assigned, or `None` before the handshake.
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// The last revision this client published.
    pub fn revision(&self) -> i64 {
        self.revision
    }

    /// The log-channel allowance the driver granted, or `None` when logs are
    /// disabled — which is the case unless the adapter announced `logs`.
    pub fn log_budget(&self) -> Option<crate::messages::LogBudget> {
        self.log_budget
    }

    /// The ceilings in force, as negotiated by `hello-ack`.
    pub fn limits(&self) -> &Limits {
        &self.limits
    }

    /// Make the next publish send a whole tree.
    ///
    /// The producer's obligation from D5: a probe that lost anything from its
    /// own stream of facts — a dropped frame, a coalesced burst, a write that
    /// failed — must not follow it with a patch. The driver would apply that
    /// patch to a tree that never accounted for what was lost, and the
    /// divergence would be silent.
    pub fn require_full_snapshot(&mut self) {
        self.force_full = true;
    }

    /// Whether the obligation is outstanding.
    #[must_use]
    pub fn full_snapshot_required(&self) -> bool {
        self.force_full
    }

    /// Drop the session. The application keeps running.
    pub fn close(&mut self) {
        if let Some(stream) = self.stream.take() {
            self.debug_line(
                Category::Sem,
                &format!(
                    "close r{} snapshots={} deltas={} logs_dropped={}",
                    self.revision, self.snapshots_sent, self.deltas_sent, self.logs_dropped
                ),
            );
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
        self.session_id = None;
    }

    /// Publish a snapshot for the next revision and return its marker.
    ///
    /// Write the marker to stdout **after** the render's last byte: it commits
    /// the bytes that precede it. `session_id` and `revision` on the snapshot
    /// are overwritten with the session's own.
    ///
    /// Returns `Ok(None)` when there is no live session or the driver did not
    /// ask for markers, so a dormant app takes no branch.
    ///
    /// # Errors
    /// Returns [`Error::Validation`] if the snapshot is invalid — that is an
    /// adapter bug, so it is loud rather than silent — or [`Error::Io`] if the
    /// channel broke.
    pub fn publish(&mut self, snapshot: &mut Snapshot) -> Result<Option<String>, Error> {
        let Some(session_id) = self.session_id.clone() else {
            return Ok(None);
        };
        if self.stream.is_none() {
            return Ok(None);
        }

        let revision = self.revision + 1;
        snapshot.v = 1;
        snapshot.session_id = session_id.clone();
        snapshot.revision = revision;

        let body = serde_json::to_string(&snapshot).map_err(|_| {
            Error::Protocol(crate::error::Violation::new(
                "frame-malformed",
                "snapshot is not JSON-serialisable",
            ))
        })?;
        let parsed: Value = serde_json::from_str(&body).expect("just serialised");
        validate_snapshot(&parsed, &self.limits)?;

        self.revision = revision;
        self.remember(revision, RawValue::from_string(body).expect("valid JSON"));

        if self.subscribe != "revisions" {
            // A delta when the driver asked for one and it is worth sending;
            // a whole tree on the first publish, under a snapshots
            // subscription, or past roughly half the tree. The base advances
            // only once a message has been built from it, so a skipped
            // publish cannot leave the driver patching a tree it never got.
            // An outstanding obligation overrides the choice: a gap in the
            // producer's own facts means the next tree must be whole.
            let forced = std::mem::take(&mut self.force_full);
            if forced {
                self.debug_line(
                    Category::Io,
                    &format!("r{revision} full snapshot: the producer reported a gap"),
                );
            }
            let delta = if self.subscribe == "diffs" && !forced {
                self.published
                    .as_ref()
                    .and_then(|base| build_delta(base, &parsed))
            } else {
                None
            };
            self.published = Some(parsed.clone());
            match delta {
                Some(delta) => {
                    self.deltas_sent += 1;
                    self.send(&delta)?;
                }
                None => {
                    self.snapshots_sent += 1;
                    self.send(&SnapshotMessage::new(snapshot))?;
                }
            }
        }
        self.send(&RevisionCommit::new(revision))?;

        if !self.marker_enabled {
            return Ok(None);
        }
        Ok(Some(encode_marker(&self.token, &session_id, revision)?))
    }

    /// Patches this client has published.
    pub fn deltas_sent(&self) -> u64 {
        self.deltas_sent
    }

    /// Whole trees this client has published.
    pub fn snapshots_sent(&self) -> u64 {
        self.snapshots_sent
    }

    /// Records this adapter dropped locally, for being over budget or over a
    /// limit. Each one left a gap in the sequence.
    pub fn logs_dropped(&self) -> u64 {
        self.logs_dropped
    }

    /// Forward one application log record, if the driver asked for logs.
    ///
    /// Returns whether the record went out. A record is dropped when the
    /// session is not live, when the driver granted no budget, when this
    /// adapter is over its rate, or when the record breaks a limit.
    ///
    /// Every attempt consumes a sequence number, dropped or not: the gap left
    /// in `seq` is precisely how the driver learns records were lost here
    /// rather than in transit.
    ///
    /// `seq` is assigned here whatever the caller set, because the adapter is
    /// the only authority on it: the channel is open to several publishers,
    /// and two of them can pick the same number in good faith. A caller's own
    /// number is kept as the `origin.seq` attribute, which is a diagnostic
    /// rather than a promise — it is dropped rather than allowed to push the
    /// record over a limit.
    pub fn log(&mut self, mut record: LogRecord) -> bool {
        if self.session_id.is_none() || self.stream.is_none() || self.log_bucket.is_none() {
            return false;
        }

        let origin = record.seq;
        self.log_seq += 1;
        record.seq = self.log_seq;
        if record.ts == 0 {
            record.ts = epoch_millis();
        }
        if record.revision.is_none() && self.revision > 0 {
            record.revision = Some(self.revision);
        }

        let now = Instant::now();
        let allowed = self
            .log_bucket
            .as_mut()
            .is_some_and(|bucket| bucket.take(now));
        if !allowed {
            self.logs_dropped += 1;
            return false;
        }
        if origin > 0 && record.attrs.len() < MAX_LOG_ATTRS {
            // A hint is never worth turning a log line into a rejected frame,
            // so it is backed out if it costs the record its validity.
            record
                .attrs
                .insert("origin.seq".to_owned(), AttrValue::Int(origin));
            if record.validate(&self.limits).is_err() {
                record.attrs.remove("origin.seq");
            }
        }
        if record.validate(&self.limits).is_err() {
            // An oversized or malformed record is dropped locally rather than
            // taking the channel down; the gap in seq reports it.
            self.logs_dropped += 1;
            return false;
        }
        self.send(&LogMessage::new(&record)).is_ok()
    }

    /// Convenience for the common call: a level and a message.
    pub fn log_message(&mut self, level: LogLevel, message: impl Into<String>) -> bool {
        self.log(LogRecord::new(level, message))
    }

    /// Read and answer whatever the driver has sent, without blocking.
    ///
    /// Call it on every render tick, or whenever convenient: `get-tree`
    /// requests are answered from the retained snapshots.
    ///
    /// # Errors
    /// Returns [`Error::Io`] if the channel broke, or [`Error::Parse`] if the
    /// driver sent something the contract forbids.
    pub fn poll(&mut self) -> Result<(), Error> {
        let mut buffer = [0u8; 8192];
        loop {
            let read = match self.stream.as_mut() {
                None => return Ok(()),
                Some(stream) => stream.read(&mut buffer),
            };
            match read {
                Ok(0) => {
                    self.close();
                    return Ok(());
                }
                Ok(count) => {
                    let frames = self.decoder.push(&buffer[..count])?;
                    for frame in frames {
                        self.handle(&frame.value)?;
                    }
                }
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
                {
                    return Ok(())
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    self.close();
                    return Err(Error::Io(error));
                }
            }
        }
    }

    fn handle(&mut self, value: &Value) -> Result<(), Error> {
        if let Err(error) = parse_driver_message(value, &self.limits) {
            self.debug_line(
                Category::Diag,
                &format!("rejected a driver message: {error}"),
            );
            let _ = self.send(&ProtocolErrorMessage::new("malformed", error.to_string()));
            self.close();
            return Err(Error::Parse(error));
        }

        match value.get("type").and_then(Value::as_str) {
            Some("hello-ack") => {
                let ack: HelloAck = serde_json::from_value(value.clone()).expect("validated above");
                self.session_id = Some(ack.session_id);
                self.limits = ack.limits;
                self.marker_enabled = ack.marker.enabled;
                self.log_budget = ack.logs;
                self.log_bucket = match ack.logs {
                    Some(budget) if budget.enabled => Some(TokenBucket::new(
                        budget.max_records_per_second,
                        budget.burst,
                        Instant::now(),
                    )),
                    _ => None,
                };
                self.subscribe = ack.subscribe;
                if let Some(log) = self.options.debug.as_ref() {
                    let session = self.session_id.clone().unwrap_or_default();
                    log.set_label(&session);
                    log.line(
                        Category::Sem,
                        &format!(
                            "hello-ack session={session} marker={} subscribe={} logs={}",
                            on_off(self.marker_enabled),
                            self.subscribe,
                            on_off(self.log_bucket.is_some())
                        ),
                    );
                }
            }
            Some("get-tree") => {
                let request: GetTree =
                    serde_json::from_value(value.clone()).expect("validated above");
                let wanted = request.revision.unwrap_or(self.revision);
                let held = self
                    .history
                    .iter()
                    .find(|(revision, _)| *revision == wanted)
                    .map(|(_, body)| body.clone());
                let answer = match held {
                    Some(body) => GetTreeResult::found(request.request_id, body),
                    None => GetTreeResult::missing(
                        request.request_id,
                        format!("revision {wanted} is not retained"),
                    ),
                };
                self.send(&answer)?;
            }
            Some("error") => {
                self.debug_line(
                    Category::Diag,
                    &format!(
                        "driver ended the session: {}",
                        value.get("code").and_then(Value::as_str).unwrap_or("?")
                    ),
                );
                self.close();
            }
            _ => {}
        }
        Ok(())
    }

    fn remember(&mut self, revision: i64, body: Box<RawValue>) {
        self.history.push_back((revision, body));
        while self.history.len() > SNAPSHOT_HISTORY {
            self.history.pop_front();
        }
    }

    fn send<T: serde::Serialize>(&mut self, message: &T) -> Result<(), Error> {
        let frame = encode_frame(message, self.limits.max_frame_bytes)?;
        let Some(stream) = self.stream.as_mut() else {
            return Ok(());
        };
        match stream.write_all(&frame).and_then(|()| stream.flush()) {
            Ok(()) => Ok(()),
            Err(error) => {
                let timed_out = matches!(
                    error.kind(),
                    ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                );
                self.close();
                if timed_out {
                    // `write_all` may have delivered part of a length-prefixed
                    // frame, and there is no resynchronisation point in the
                    // stream, so the session is unrecoverable rather than slow.
                    self.debug_line(
                        Category::Diag,
                        "write deadline exceeded; session is unrecoverable",
                    );
                    return Err(Error::WriteTimeout);
                }
                Err(Error::Io(error))
            }
        }
    }
}
