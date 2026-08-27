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
//! Everything here fails closed for semantic publication while leaving the
//! application's rendering alone. In particular, a marker is never guessed to
//! belong on process stdout: the patched backend must certify and use the exact
//! writer that carried the frame. The render hook validates and encodes the
//! complete semantic revision, then performs one non-blocking admission to a
//! bounded worker queue; it never writes the semantic socket itself.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use termwright_protocol::client::{Client, Options};
use termwright_protocol::debug::{Category, DebugLog};
use termwright_protocol::roles::Capability;
use termwright_protocol::{Error, PublicationQueue, ABSOLUTE_LIMITS};

use crate::tree::{duplicate_semantic_key, snapshot_from_with_relation_limit};
use crate::{probe_info, take_frame};

/// How long the handshake may take before the probe gives up on this run.
///
/// Startup-only handshake budget. `initialize` is injected into Terminal
/// construction, before the application enters its render loop.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// The live session, or the fact that there will not be one.
enum State {
    /// Nothing tried yet.
    Idle,
    Connected(Box<PublicationQueue>),
    /// Publication has failed closed, but the worker is retained until the
    /// final Terminal guard can drain/join it before process exit.
    Failed(Box<PublicationQueue>),
    /// Tried and failed, or gave up. Never retried: a probe that reconnects
    /// from inside a render loop turns one bad session into a stutter on every
    /// frame.
    Done,
}

static TERMINALS: AtomicUsize = AtomicUsize::new(0);

const RENDER_IDLE: u8 = 0;
const RENDER_ACTIVE: u8 = 1;
const RENDER_FAILED: u8 = 2;

// This is deliberately an atomic admission gate, not a blocking render mutex.
// A concurrent frame changes ACTIVE to FAILED and continues rendering without
// waiting. The active publisher then observes FAILED before it can release a
// marker and closes semantics causally.
static RENDER_ADMISSION: AtomicU8 = AtomicU8::new(RENDER_IDLE);
static SESSION_FAILURE_PENDING: AtomicBool = AtomicBool::new(false);

struct RenderPermit {
    active: bool,
}

impl RenderPermit {
    fn acquire() -> Option<Self> {
        match RENDER_ADMISSION.compare_exchange(
            RENDER_IDLE,
            RENDER_ACTIVE,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => Some(Self { active: true }),
            Err(RENDER_ACTIVE) => {
                RENDER_ADMISSION.store(RENDER_FAILED, Ordering::Release);
                SESSION_FAILURE_PENDING.store(true, Ordering::Release);
                None
            }
            Err(_) => None,
        }
    }

    fn release_successfully(mut self) -> bool {
        self.active = false;
        RENDER_ADMISSION
            .compare_exchange(
                RENDER_ACTIVE,
                RENDER_IDLE,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

impl Drop for RenderPermit {
    fn drop(&mut self) {
        if self.active {
            let _ = RENDER_ADMISSION.compare_exchange(
                RENDER_ACTIVE,
                RENDER_IDLE,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        }
    }
}

/// Marker bytes plus the non-blocking publication permit. The permit remains
/// held until the patched backend has synchronously appended these bytes to
/// the same writer, preventing another terminal from overtaking the commit.
pub struct FrameMarker {
    bytes: String,
    permit: RenderPermit,
}

impl FrameMarker {
    pub fn as_bytes(&self) -> &[u8] {
        self.bytes.as_bytes()
    }
}

impl Drop for FrameMarker {
    fn drop(&mut self) {
        let permit = std::mem::replace(&mut self.permit, RenderPermit { active: false });
        if !permit.release_successfully() {
            SESSION_FAILURE_PENDING.store(true, Ordering::Release);
            deliver_pending_failure();
        }
    }
}

fn deliver_pending_failure() {
    if !SESSION_FAILURE_PENDING.load(Ordering::Acquire) {
        return;
    }
    let Ok(mut guard) = state().try_lock() else {
        // Lifecycle code observes the same flag before draining. Never wait
        // here: FrameMarker drops on the application's render thread.
        return;
    };
    let State::Connected(client) = &mut *guard else {
        return;
    };
    client.fail(
        "adapter-guarantee-violation",
        "Ratatui semantic publication encountered concurrent render or lifecycle state contention",
    );
    if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
        *guard = State::Failed(publisher);
        SESSION_FAILURE_PENDING.store(false, Ordering::Release);
    }
}

/// Per-Terminal lifecycle guard injected into `ratatui-core`.
///
/// Cloning a Terminal clones this inert-when-dormant guard and retains the shared
/// semantic session. Only the final drop drains the publication worker, so a
/// one-frame process cannot exit ahead of an admitted snapshot or fatal.
#[derive(Debug, Eq, PartialEq, Hash)]
pub struct TerminalGuard {
    active: bool,
}

impl Clone for TerminalGuard {
    fn clone(&self) -> Self {
        if self.active {
            TERMINALS.fetch_add(1, Ordering::Relaxed);
        }
        Self {
            active: self.active,
        }
    }
}

impl Default for TerminalGuard {
    fn default() -> Self {
        initialize()
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        if self.active && TERMINALS.fetch_sub(1, Ordering::AcqRel) == 1 {
            shutdown();
        }
    }
}

fn state() -> &'static Mutex<State> {
    static STATE: Mutex<State> = Mutex::new(State::Idle);
    &STATE
}

/// Initialize semantic transport during `Terminal::with_options`, never from
/// a render callback. Failure is soft for the application and permanent for
/// this semantic session; there are no retries on later frames.
pub fn initialize() -> TerminalGuard {
    if !crate::active() {
        announce_dormant_once();
        return TerminalGuard { active: false };
    }
    TERMINALS.fetch_add(1, Ordering::Relaxed);
    let Ok(mut guard) = state().lock() else {
        return TerminalGuard { active: true };
    };
    if matches!(*guard, State::Idle) {
        *guard = match connect() {
            Some(publisher) => State::Connected(Box::new(publisher)),
            None => State::Done,
        };
    }
    TerminalGuard { active: true }
}

fn shutdown() {
    let Ok(mut state) = state().lock() else {
        return;
    };
    match std::mem::replace(&mut *state, State::Done) {
        State::Connected(mut publisher) => {
            if SESSION_FAILURE_PENDING.swap(false, Ordering::AcqRel) {
                publisher.fail(
                    "adapter-guarantee-violation",
                    "Ratatui semantic publication encountered concurrent render or lifecycle state contention",
                );
                let _ = publisher.shutdown();
                return;
            }
            // Keep the lifecycle lock across drain/join. A Terminal created
            // concurrently must start only after this clean session is fully
            // closed, otherwise it would observe a transient Done state and
            // silently miss semantics.
            if publisher.shutdown() {
                *state = State::Idle;
            }
        }
        State::Failed(publisher) => {
            // A producer-contract failure is permanent for this process. A
            // later Terminal must not reconnect and bypass fail-closed state.
            let _ = publisher.shutdown();
        }
        State::Idle => *state = State::Idle,
        State::Done => {}
    }
}

/// Called by the patched `ratatui-core` once a frame's bytes have been flushed.
///
/// `frame` is Ratatui's own counter, and `columns`/`rows` the area it just
/// drew into.
pub fn on_frame_end(frame: u64, columns: u16, rows: u16) -> Option<FrameMarker> {
    if !crate::active() {
        // As dormant as the render hook, and for the same reason: this runs on
        // the render thread of an application that never asked for any of
        // this. The reason is worth saying once, to whoever went to the
        // trouble of configuring a diagnostic file.
        announce_dormant_once();
        return None;
    }
    if !crate::frame_guard_active() {
        fail_without_publication(
            "Ratatui semantic probe unavailable: render occurred outside the certified Terminal::try_draw lifecycle",
        );
        return None;
    }
    let Some(permit) = RenderPermit::acquire() else {
        let _ = take_frame();
        return None;
    };
    let Ok(mut guard) = state().try_lock() else {
        SESSION_FAILURE_PENDING.store(true, Ordering::Release);
        RENDER_ADMISSION.store(RENDER_FAILED, Ordering::Release);
        let _ = take_frame();
        return None;
    };
    if matches!(*guard, State::Done | State::Failed(_)) {
        // Still drain the buffer, or a dead session leaks a frame's calls on
        // every frame for the life of the process.
        let _ = take_frame();
        return None;
    }
    if matches!(*guard, State::Idle) {
        // A constructor path that bypassed the certified hook is reduced
        // capability, never permission to block inside a render callback.
        let _ = take_frame();
        return None;
    }
    let State::Connected(client) = &mut *guard else {
        let _ = take_frame();
        return None;
    };

    let calls = take_frame();
    if let Some(key) = duplicate_semantic_key(&calls) {
        let message = format!("duplicate SemanticKey {key:?}");
        client.fail("duplicate-semantic-key", &message);
        if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
            *guard = State::Failed(publisher);
        }
        return None;
    }
    let mut snapshot = snapshot_from_with_relation_limit(
        &calls,
        frame,
        columns,
        rows,
        client.limits().max_relation_targets,
    );
    match client.publish(&mut snapshot) {
        Ok(Some(marker)) => {
            if RENDER_ADMISSION.load(Ordering::Acquire) == RENDER_ACTIVE {
                return Some(FrameMarker {
                    bytes: marker,
                    permit,
                });
            }
            client.fail(
                "adapter-guarantee-violation",
                "Ratatui semantic publication encountered concurrent render contention",
            );
            if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
                *guard = State::Failed(publisher);
            }
            return None;
        }
        Ok(None) => {}
        Err(error) => {
            // The visual frame already landed. Keeping the previous semantic
            // tree after any admission refusal would make it authoritative for
            // a newer screen, so fail the semantic session immediately.
            let detail = publication_failure_detail(&error, client.limits().max_queued_frames);
            client.fail("adapter-guarantee-violation", &detail);
            if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
                *guard = State::Failed(publisher);
            }
        }
    }
    None
}

fn publication_failure_detail(error: &Error, queue_capacity: usize) -> String {
    let maximum = ABSOLUTE_LIMITS.max_queued_frames;
    if matches!(error, Error::PublicationQueueFull) {
        if queue_capacity >= maximum {
            return format!(
                "Ratatui rendered a frame that semantic publication did not admit: semantic publication queue exhausted its negotiated budget of {queue_capacity} frames, which is the protocol maximum; reduce or split the application's synchronous render burst"
            );
        }
        return format!(
            "Ratatui rendered a frame that semantic publication did not admit: semantic publication queue exhausted its negotiated budget of {queue_capacity} frames; increase it with terminal.launch({{ semanticFrameQueueCapacity: {} }}) (maximum {maximum}), or reduce the application's synchronous render burst",
            (queue_capacity.saturating_mul(2)).min(maximum),
        );
    }
    format!("Ratatui rendered a frame that semantic publication did not admit: {error}")
}

fn fail_without_publication(message: &str) {
    let _ = take_frame();
    let Ok(mut guard) = state().try_lock() else {
        SESSION_FAILURE_PENDING.store(true, Ordering::Release);
        return;
    };
    let State::Connected(client) = &mut *guard else {
        return;
    };
    client.fail("adapter-guarantee-violation", message);
    if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
        *guard = State::Failed(publisher);
    }
}

/// Refuse semantic publication when the active backend cannot prove where its
/// frame bytes were written.
///
/// This is deliberately called before [`on_frame_end`], so no snapshot can
/// escape and wait forever for a marker on an unrelated stream.
pub fn on_marker_sink_unsupported() {
    if !crate::active() {
        let _ = take_frame();
        announce_dormant_once();
        return;
    }
    let Some(_permit) = RenderPermit::acquire() else {
        let _ = take_frame();
        return;
    };
    let Ok(mut guard) = state().try_lock() else {
        SESSION_FAILURE_PENDING.store(true, Ordering::Release);
        let _ = take_frame();
        return;
    };
    let _ = take_frame();
    if matches!(*guard, State::Done | State::Failed(_)) {
        return;
    }
    if matches!(*guard, State::Idle) {
        *guard = State::Done;
        return;
    }
    let State::Connected(client) = &mut *guard else {
        return;
    };
    const MESSAGE: &str = "Ratatui semantic probe unavailable: the active Backend has no certified render-commit marker sink";
    client.fail("adapter-guarantee-violation", MESSAGE);
    if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
        *guard = State::Failed(publisher);
    }
}

/// Permanently fail the semantic session if a certified backend writer rejects
/// the marker. The application draw itself is not failed: the visual frame was
/// already flushed successfully, while the semantic revision is unusable.
pub fn on_marker_write_failed(message: &str) {
    let Ok(mut guard) = state().try_lock() else {
        SESSION_FAILURE_PENDING.store(true, Ordering::Release);
        return;
    };
    let State::Connected(client) = &mut *guard else {
        return;
    };
    let message = format!("certified Ratatui marker sink failed: {message}");
    client.fail("adapter-guarantee-violation", &message);
    if let State::Connected(publisher) = std::mem::replace(&mut *guard, State::Done) {
        *guard = State::Failed(publisher);
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

fn connect() -> Option<PublicationQueue> {
    let mut options = Options::new("ratatui-probe", env!("CARGO_PKG_VERSION"));
    options.evidence_registry = Some(termwright_protocol::evidence::global_registry());
    options.capabilities = vec![
        Capability::Tree,
        Capability::IntendedGeometry,
        Capability::States,
        Capability::Actions,
        Capability::RenderRevisions,
    ];
    options.probe = Some(probe_info(Some(ratatui_version())));
    let mut client = Client::from_env(options)?;
    match client.connect(CONNECT_TIMEOUT) {
        Ok(()) => {
            log(Category::Sem, "session started");
            // Use the queue budget negotiated with the driver. A hard-coded
            // capacity of two made an ordinary short burst scheduler-dependent:
            // either the worker drained between draws or the third frame failed
            // the semantic session. The protocol limit is the shared memory and
            // back-pressure contract; exceeding it still fails closed.
            let queue_capacity = client.limits().max_queued_frames;
            match PublicationQueue::new(client, queue_capacity) {
                Ok(publisher) => Some(publisher),
                Err(error) => {
                    log(
                        Category::Diag,
                        &format!("publication worker unavailable: {error}"),
                    );
                    None
                }
            }
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

fn log(category: Category, message: &str) {
    if let Some(log) = DebugLog::from_env("ratatui-probe") {
        log.line(category, message);
        log.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    /// Dormant: with no endpoint and no token there is no session to start, and
    /// the hook must not leave a frame's calls sitting in the buffer either.
    #[test]
    fn a_dormant_process_publishes_nothing_and_leaks_nothing() {
        crate::on_render("Fixture", 0, 0, 1, 1);
        on_frame_end(1, 80, 24);
        assert!(take_frame().is_empty());
    }

    #[test]
    fn concurrent_render_admission_fails_without_waiting_or_reordering_a_marker() {
        RENDER_ADMISSION.store(RENDER_IDLE, Ordering::Release);
        SESSION_FAILURE_PENDING.store(false, Ordering::Release);
        let first = RenderPermit::acquire().expect("first render permit");
        let rendezvous = Arc::new(Barrier::new(2));
        std::thread::scope(|scope| {
            let worker_rendezvous = rendezvous.clone();
            scope.spawn(move || {
                worker_rendezvous.wait();
                assert!(RenderPermit::acquire().is_none());
            });
            rendezvous.wait();
        });

        assert!(SESSION_FAILURE_PENDING.load(Ordering::Acquire));
        assert!(
            !first.release_successfully(),
            "the first render must not release a marker after a concurrent frame"
        );
        assert_eq!(RENDER_ADMISSION.load(Ordering::Acquire), RENDER_FAILED);

        // Isolate process-global state from the remaining unit tests. A real
        // session deliberately leaves this failed until its final guard drains.
        RENDER_ADMISSION.store(RENDER_IDLE, Ordering::Release);
        SESSION_FAILURE_PENDING.store(false, Ordering::Release);
    }

    #[test]
    fn queue_overflow_diagnostic_names_the_budget_and_real_launch_option() {
        let detail = publication_failure_detail(&Error::PublicationQueueFull, 32);
        assert!(detail.contains("negotiated budget of 32 frames"));
        assert!(detail.contains("terminal.launch({ semanticFrameQueueCapacity: 64 })"));
        assert!(detail.contains("maximum 256"));
    }

    #[test]
    fn queue_overflow_at_the_protocol_ceiling_does_not_suggest_a_noop_increase() {
        let maximum = ABSOLUTE_LIMITS.max_queued_frames;
        let detail = publication_failure_detail(&Error::PublicationQueueFull, maximum);
        assert!(detail.contains(&format!("negotiated budget of {maximum} frames")));
        assert!(detail.contains("which is the protocol maximum"));
        assert!(!detail.contains("semanticFrameQueueCapacity"));
    }
}
