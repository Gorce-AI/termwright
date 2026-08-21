//! Opt-in diagnostic log for the adapter side, written to a file.
//!
//! The driver has its own live log (`TERMWRIGHT_DEBUG=1`, stderr, see
//! `packages/driver/src/debug.ts`). This is the other half: what the *adapter*
//! inside the application decided, which is the half that goes missing when a
//! conformance run reports skips and nobody can say why the app never
//! attached.
//!
//! **Never stderr.** The application under test owns the terminal; a stray
//! line on stderr lands in the middle of a render and corrupts the very screen
//! the driver is asserting on. So this log goes to a file the caller names, or
//! nowhere.
//!
//! **Never fatal.** Every failure here — an unwritable path, a full disk, a
//! poisoned lock — leaves the application running and the log silently off.
//!
//! Enable it with either variable:
//!
//! ```text
//! TERMWRIGHT_DEBUG_FILE=/tmp/adapter.log     # preferred
//! TERMWRIGHT_DEBUG=/tmp/adapter.log          # path, not 1/true/all
//! ```
//!
//! The second form is deliberately restricted to values that are *not* the
//! driver's own switches: `TERMWRIGHT_DEBUG=1` reaches the child process too,
//! and if that turned this log on it would have to invent a destination for
//! it.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;

/// Names the file this log is written to. Preferred over `TERMWRIGHT_DEBUG`
/// because it cannot collide with the driver's stderr switch.
pub const ENV_DEBUG_FILE: &str = "TERMWRIGHT_DEBUG_FILE";

/// The driver's switch, honoured here only when it carries a path.
pub const ENV_DEBUG: &str = "TERMWRIGHT_DEBUG";

/// Values of `TERMWRIGHT_DEBUG` that mean "driver-side logging" and must not
/// be mistaken for a filename.
const DRIVER_SWITCHES: [&str; 8] = ["0", "1", "true", "false", "on", "off", "api", "all"];

const MAX_MESSAGE: usize = 400;

/// Which part of the adapter a line is about, borrowed from the driver's
/// vocabulary so one reader greps both logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    /// A decision or a failure — why the adapter did or did not attach.
    Diag,
    /// The semantic session: dial, handshake, close.
    Sem,
    /// Traffic: what was published for which revision.
    Io,
    /// The application's own forwarded logs.
    App,
}

impl Category {
    fn as_str(self) -> &'static str {
        match self {
            Self::Diag => "diag",
            Self::Sem => "sem",
            Self::Io => "io",
            Self::App => "app",
        }
    }
}

/// The file this process should log to, or `None` to stay silent.
///
/// `lookup` is the environment; pass a closure over [`std::env::var`] outside
/// tests, which is what [`DebugLog::from_env`] does.
pub fn debug_path<F>(lookup: F) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    if let Some(explicit) = lookup(ENV_DEBUG_FILE) {
        let explicit = explicit.trim().to_owned();
        if !explicit.is_empty() {
            return Some(explicit);
        }
    }
    let raw = lookup(ENV_DEBUG)?.trim().to_owned();
    if raw.is_empty() || DRIVER_SWITCHES.contains(&raw.to_ascii_lowercase().as_str()) {
        return None;
    }
    Some(raw)
}

/// Appends diagnostic lines to one file.
#[derive(Debug)]
pub struct DebugLog {
    state: Mutex<State>,
    started: Instant,
}

#[derive(Debug)]
struct State {
    file: Option<File>,
    label: String,
}

impl DebugLog {
    /// Open the log named by the process environment, or `None`.
    #[must_use]
    pub fn from_env(adapter: &str) -> Option<Self> {
        let path = debug_path(|name| std::env::var(name).ok())?;
        Self::open(&path, adapter)
    }

    /// Append to `path`, or return `None` when it cannot be opened.
    ///
    /// Returning `None` rather than an error is deliberate: a diagnostic that
    /// refuses to start must not stop the application, and no caller has
    /// anything to do with the failure.
    #[must_use]
    pub fn open(path: &str, adapter: &str) -> Option<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()?;
        let log = Self {
            state: Mutex::new(State {
                file: Some(file),
                label: format!("p{}", std::process::id()),
            }),
            started: Instant::now(),
        };
        log.line(
            Category::Diag,
            &format!(
                "open adapter={adapter} pid={} platform={}/{} argv0={}",
                std::process::id(),
                std::env::consts::OS,
                std::env::consts::ARCH,
                short(&argv0()),
            ),
        );
        Some(log)
    }

    /// Adopt the driver's session id once the handshake supplies one,
    /// truncated to the eight characters the driver's own log uses.
    pub fn set_label(&self, label: &str) {
        if label.is_empty() {
            return;
        }
        let short = label.chars().take(8).collect::<String>();
        if let Ok(mut state) = self.state.lock() {
            state.label = short;
        }
    }

    /// The bracketed identifier on every line.
    #[must_use]
    pub fn label(&self) -> String {
        self.state
            .lock()
            .map(|state| state.label.clone())
            .unwrap_or_default()
    }

    /// Write one line. Silently does nothing once the file is gone.
    pub fn line(&self, category: Category, message: &str) {
        let message = if message.len() > MAX_MESSAGE {
            let mut cut = MAX_MESSAGE;
            while cut > 0 && !message.is_char_boundary(cut) {
                cut -= 1;
            }
            format!("{}…", &message[..cut])
        } else {
            message.to_owned()
        };
        let seconds = self.started.elapsed().as_secs_f64();
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let text = format!(
            "  tw:{:<4} [{}] {:>7.3}s {message}\n",
            category.as_str(),
            state.label,
            seconds,
        );
        let failed = match state.file.as_mut() {
            Some(file) => file
                .write_all(text.as_bytes())
                .and_then(|()| file.flush())
                .is_err(),
            None => false,
        };
        if failed {
            // The log is over; the application is not.
            state.file = None;
        }
    }

    /// Close the file. Safe to call more than once.
    pub fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.file = None;
        }
    }
}

/// How an endpoint reads in the log: its transport and its path.
///
/// The endpoint is not a secret — the token is, and the token never appears
/// here — but it is long, so it is shortened from the left, keeping the tail
/// that distinguishes one session's socket from another's.
#[must_use]
pub fn describe_endpoint(endpoint: &str) -> String {
    let kind = if endpoint.starts_with(r"\\.\pipe\") || endpoint.starts_with(r"\\?\pipe\") {
        "pipe"
    } else {
        "unix"
    };
    format!("{kind}:{}", short(endpoint))
}

fn short(value: &str) -> String {
    const LIMIT: usize = 60;
    if value.chars().count() <= LIMIT {
        return value.to_owned();
    }
    let tail: String = value
        .chars()
        .skip(value.chars().count() - (LIMIT - 1))
        .collect();
    format!("…{tail}")
}

fn argv0() -> String {
    std::env::args()
        .next()
        .and_then(|path| {
            std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_default()
}

/// How a negotiated switch reads in the log.
pub(crate) fn on_off(enabled: bool) -> &'static str {
    if enabled {
        "on"
    } else {
        "off"
    }
}

/// A one-line description of an I/O failure: kind, raw OS error and message.
///
/// The kind is always printed, even when the message repeats it. The kind
/// alone is what usually settles a Windows question — `NotFound` on a pipe
/// path means the driver was never listening, while `InvalidInput` means the
/// path was never openable by this transport in the first place.
pub(crate) fn error_label(error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(code) => format!("{:?} [errno {code}]: {error}", error.kind()),
        None => format!("{:?}: {error}", error.kind()),
    }
}

/// The announced capability set as one log field, comma separated.
///
/// Rendered through serde so the log shows wire names (`intended-geometry`)
/// rather than Rust variant names (`IntendedGeometry`), and so this line
/// reads the same in all three clients.
pub(crate) fn join_capabilities(capabilities: &[crate::roles::Capability]) -> String {
    capabilities
        .iter()
        .map(|capability| {
            serde_json::to_string(capability)
                .unwrap_or_default()
                .trim_matches('"')
                .to_owned()
        })
        .collect::<Vec<_>>()
        .join(",")
}
