//! Bridge from [`tracing`] onto the semantic channel.
//!
//! A TUI must not write diagnostics to the screen, so the usual advice is a
//! file appender. Under the driver they can go somewhere better: install this
//! layer and every event the application already emits becomes assertable test
//! state, with the application's own `tracing` calls unchanged.
//!
//! ```no_run
//! use std::sync::{Arc, Mutex};
//! use termwright_protocol::{Client, Options};
//! use termwright_protocol::tracing_layer::TermwrightLayer;
//! use tracing_subscriber::prelude::*;
//!
//! let client = Client::from_env(Options::with_logs("my-tui", "1.0.0"))
//!     .map(|mut client| {
//!         let _ = client.connect(termwright_protocol::DIAL_TIMEOUT);
//!         Arc::new(Mutex::new(client))
//!     });
//! if let Some(client) = client {
//!     tracing_subscriber::registry().with(TermwrightLayer::new(client)).init();
//! }
//! ```
//!
//! Enabled by the `tracing` feature, which is off by default: the protocol
//! client itself stays dependency-light for adapters that do not want a
//! logging framework.

use std::sync::{Arc, Mutex};

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

use crate::client::Client;
use crate::logs::{AttrValue, LogLevel, LogRecord};

/// A [`Layer`] forwarding events to a [`Client`].
///
/// The client is shared behind a mutex because `tracing` may emit from any
/// thread while the render loop owns the same client.
#[derive(Debug, Clone)]
pub struct TermwrightLayer {
    client: Arc<Mutex<Client>>,
}

impl TermwrightLayer {
    /// Forward events to `client`.
    pub fn new(client: Arc<Mutex<Client>>) -> Self {
        Self { client }
    }
}

/// Map a `tracing` level onto the wire's closed ladder. `tracing` has no
/// `fatal`: `error!` is the most severe level it can express.
pub fn level_for(level: &Level) -> LogLevel {
    match *level {
        Level::TRACE => LogLevel::Trace,
        Level::DEBUG => LogLevel::Debug,
        Level::INFO => LogLevel::Info,
        Level::WARN => LogLevel::Warn,
        Level::ERROR => LogLevel::Error,
    }
}

/// Collects an event's fields into a flat record.
#[derive(Default)]
struct RecordVisitor {
    message: String,
    attrs: Vec<(String, AttrValue)>,
}

impl Visit for RecordVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_owned();
        } else {
            self.attrs
                .push((field.name().to_owned(), AttrValue::Text(value.to_owned())));
        }
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.attrs
            .push((field.name().to_owned(), AttrValue::Bool(value)));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.attrs
            .push((field.name().to_owned(), AttrValue::Int(value)));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.attrs
            .push((field.name().to_owned(), AttrValue::from(value)));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.attrs
            .push((field.name().to_owned(), AttrValue::from(value)));
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.attrs
            .push((field.name().to_owned(), AttrValue::Text(value.to_string())));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let rendered = format!("{value:?}");
        if field.name() == "message" {
            self.message = rendered;
        } else {
            // Keeping the text beats dropping the field: a record that loses a
            // value's shape is still more use than one that never arrives.
            self.attrs
                .push((field.name().to_owned(), AttrValue::Text(rendered)));
        }
    }
}

impl<S: Subscriber> Layer<S> for TermwrightLayer {
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        let mut visitor = RecordVisitor::default();
        event.record(&mut visitor);

        let metadata = event.metadata();
        let mut record = LogRecord::new(level_for(metadata.level()), visitor.message)
            .with_logger(metadata.target());
        for (key, value) in visitor.attrs {
            record.attrs.insert(key, value);
        }

        // A logging call must never fail the application: the client drops
        // what it cannot send and counts it, and the gap in seq reports it.
        if let Ok(mut client) = self.client.lock() {
            client.log(record);
        }
    }
}
