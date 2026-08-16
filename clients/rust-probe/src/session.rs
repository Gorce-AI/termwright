//! Publishing one instrumented Ratatui application's frames.
//!
//! The end of a frame is a real, observable moment in Ratatui, and it is not
//! where a reader would first guess. `Terminal::apply_buffer_with_cursor`
//! (`ratatui-core/src/terminal/render.rs`) applies the buffer diff, moves the
//! cursor, swaps buffers, and then calls `Backend::flush`. Only after that last
//! call are the frame's bytes actually on the terminal.
//!
//! That is why the probe hooks *after* it: the marker commits the bytes that
//! precede it, so it has to be written once they are out. The same ordering as
//! Textual's `post_display_hook`, arrived at from the opposite direction —
//! there the flush is inside the framework's own hook, here we had to find the
//! line it happens on.
//!
//! Everything here fails quietly. The application owns the terminal and the
//! exit code; a side channel that cannot connect, cannot build a tree, or
//! cannot write must leave the application rendering exactly as it would have
//! rendered alone.

use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

use termwright_protocol::client::{Client, Options};
use termwright_protocol::debug::{Category, DebugLog};
use termwright_protocol::roles::Capability;

use crate::tree::snapshot_from;
use crate::{probe_info, take_frame};

/// How long the handshake may take before the probe gives up on this run.
///
/// Short on purpose: this runs on the render thread of an application that is
/// mid-frame, and a driver that is not there yet will not become there by
/// being waited for.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// The live session, or the fact that there will not be one.
enum State {
    /// Nothing tried yet.
    Idle,
    Connected(Box<Client>),
    /// Tried and failed, or gave up. Never retried: a probe that reconnects
    /// from inside a render loop turns one bad session into a stutter on every
    /// frame.
    Done,
}

fn state() -> &'static Mutex<State> {
    static STATE: Mutex<State> = Mutex::new(State::Idle);
    &STATE
}

/// Called by the patched `ratatui-core` once a frame's bytes have been flushed.
///
/// `frame` is Ratatui's own counter, and `columns`/`rows` the area it just
/// drew into.
pub fn on_frame_end(frame: u64, columns: u16, rows: u16) {
    if !crate::active() {
        // As dormant as the render hook, and for the same reason: this runs on
        // the render thread of an application that never asked for any of
        // this. The reason is worth saying once, to whoever went to the
        // trouble of configuring a diagnostic file.
        announce_dormant_once();
        return;
    }
    let Ok(mut guard) = state().lock() else {
        return;
    };
    if matches!(*guard, State::Done) {
        // Still drain the buffer, or a dead session leaks a frame's calls on
        // every frame for the life of the process.
        let _ = take_frame();
        return;
    }
    if matches!(*guard, State::Idle) {
        *guard = match connect() {
            Some(client) => State::Connected(Box::new(client)),
            None => State::Done,
        };
    }
    let State::Connected(client) = &mut *guard else {
        let _ = take_frame();
        return;
    };

    let calls = take_frame();
    let mut snapshot = snapshot_from(&calls, frame, columns, rows);
    match client.publish(&mut snapshot) {
        Ok(Some(marker)) => write_marker(&marker),
        Ok(None) => {}
        Err(error) => {
            // A refused snapshot is our bug and will recur; a write timeout
            // means the driver stopped reading and the session is already
            // closed. Neither is the application's problem.
            log(Category::Diag, &format!("publish failed: {error}"));
            *guard = State::Done;
        }
    }
}

/// Say once why nothing will be published, for a run that was patched but not
/// instrumented — a typo in one of the two variables looks exactly like a
/// probe that does not work.
fn announce_dormant_once() {
    static ANNOUNCED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    let mut first = false;
    ANNOUNCED.get_or_init(|| first = true);
    if !first {
        return;
    }
    let missing: Vec<&str> = [
        termwright_protocol::client::ENV_ENDPOINT,
        termwright_protocol::client::ENV_TOKEN,
    ]
    .into_iter()
    .filter(|key| {
        std::env::var(key)
            .map(|value| value.is_empty())
            .unwrap_or(true)
    })
    .collect();
    if missing.is_empty() {
        return;
    }
    log(
        Category::Diag,
        &format!("dormant: {} not set", missing.join(" and ")),
    );
}

fn connect() -> Option<Client> {
    let mut options = Options::new("ratatui-probe", env!("CARGO_PKG_VERSION"));
    options.capabilities = vec![
        Capability::Tree,
        Capability::Bounds,
        Capability::AbsoluteBounds,
        Capability::RenderRevisions,
    ];
    options.probe = Some(probe_info(Some(ratatui_version())));
    let mut client = Client::from_env(options)?;
    match client.connect(CONNECT_TIMEOUT) {
        Ok(()) => {
            log(Category::Sem, "session started");
            Some(client)
        }
        Err(error) => {
            log(
                Category::Diag,
                &format!("no session, publishing nothing: {error}"),
            );
            None
        }
    }
}

/// The Ratatui version this probe was patched into, when the patch set said so.
///
/// Supplied by the applier through an environment variable rather than read
/// from a manifest at runtime: the probe must not open files from inside a
/// render loop, and the version is fixed for the life of the process.
fn ratatui_version() -> &'static str {
    static VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    VERSION.get_or_init(|| {
        std::env::var("TERMWRIGHT_RATATUI_VERSION").unwrap_or_else(|_| "unknown".into())
    })
}

/// Write the render-commit marker after the frame's last byte.
///
/// Straight to `stdout`, because the backend has already flushed and this is
/// the same stream it flushed to. Anything that goes wrong here is silent: a
/// marker is a claim about bytes that are already on the terminal, and failing
/// to make it costs a revision, not a frame.
fn write_marker(marker: &str) {
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    if handle.write_all(marker.as_bytes()).is_ok() {
        let _ = handle.flush();
    }
}

fn log(category: Category, message: &str) {
    if let Some(log) = DebugLog::from_env("ratatui-probe") {
        log.line(category, message);
        log.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dormant: with no endpoint and no token there is no session to start, and
    /// the hook must not leave a frame's calls sitting in the buffer either.
    #[test]
    fn a_dormant_process_publishes_nothing_and_leaks_nothing() {
        crate::on_render("Fixture", 0, 0, 1, 1);
        on_frame_end(1, 80, 24);
        assert!(take_frame().is_empty());
    }
}
