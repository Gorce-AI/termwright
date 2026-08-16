//! What a patched `ratatui-core` calls, and what it is allowed to claim.
//!
//! Ratatui is immediate mode. There is no retained tree, no widget that
//! outlives the call that drew it, and no record of which widget owns which
//! cell. The Phase 0 audit (`docs/architecture/audit/ratatui.md`) settled what
//! follows from that, and this crate is written to respect it rather than to
//! paper over it:
//!
//! - **Identity is frame-local.** `Widget::render` takes `self` by value, so
//!   the widget is consumed by the call and nothing survives to be named
//!   again. Ordinals within a frame are honest; correlating them across frames
//!   is not, and the probe says so in its handshake rather than inventing a
//!   handle a test would later be written against.
//! - **`area` is intent, not ownership.** A later write silently wins and
//!   nothing records that it happened, so the rectangle a widget was drawn
//!   into is not the cells it ended up with. It is reported as the intended
//!   rectangle and never as a visible one.
//! - **Paint order is unavailable**, so every node this probe produces says
//!   `occlusion: "unknown"` and the driver refuses pointer actions against it.
//!   That is the correct outcome for this framework, not a gap to be filled in
//!   later.
//!
//! The crate is deliberately small. It is a hook, a buffer of what one frame
//! contained, and the protocol client — everything that needs `std`, kept out
//! of the `no_std` crate that calls it.

pub mod patchset;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use termwright_protocol::client::{ENV_ENDPOINT, ENV_TOKEN};
use termwright_protocol::debug::{Category, DebugLog};

/// One `render_widget` call, as the patched crate reported it.
///
/// `type_name` is what `core::any::type_name` produced — a path like
/// `ratatui_widgets::paragraph::Paragraph<'_>` for a built-in, or the
/// application's own type for a custom widget. A hint, never a role.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderCall {
    /// Position in this frame's call stream. Meaningful only within the frame.
    pub ordinal: u32,
    pub type_name: &'static str,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// What the probe collected for the frame currently being drawn.
#[derive(Debug, Default)]
pub struct FrameBuffer {
    calls: Vec<RenderCall>,
}

impl FrameBuffer {
    /// The calls seen so far, in the order the application made them.
    #[must_use]
    pub fn calls(&self) -> &[RenderCall] {
        &self.calls
    }

    /// Forget this frame's calls, keeping the allocation for the next one.
    pub fn clear(&mut self) {
        self.calls.clear();
    }
}

/// Whether this process was launched with instrumentation.
///
/// Read once and cached: the hook sits in the render path of every widget of
/// every frame, and an environment lookup per call would be a cost the
/// application never asked to pay.
fn instrumented() -> bool {
    static STATE: OnceLock<bool> = OnceLock::new();
    *STATE.get_or_init(|| {
        let named = |key: &str| std::env::var(key).map(|v| !v.is_empty()).unwrap_or(false);
        named(ENV_ENDPOINT) && named(ENV_TOKEN)
    })
}

/// Set once the probe has decided it cannot work, so it stops trying.
static DISABLED: AtomicBool = AtomicBool::new(false);

fn buffer() -> &'static Mutex<FrameBuffer> {
    static BUFFER: OnceLock<Mutex<FrameBuffer>> = OnceLock::new();
    BUFFER.get_or_init(|| Mutex::new(FrameBuffer::default()))
}

/// Called by the patched `ratatui-core` for every `Frame::render_widget`.
///
/// This runs inside the application's render path, so it does the least it
/// can: one atomic read when dormant, and one push when not. It never
/// allocates a socket, never blocks on one, and never panics — a poisoned
/// lock disables the probe rather than unwinding into a frame the application
/// is halfway through drawing.
pub fn on_render(type_name: &'static str, x: u16, y: u16, width: u16, height: u16) {
    if !instrumented() || DISABLED.load(Ordering::Relaxed) {
        return;
    }
    let Ok(mut frame) = buffer().lock() else {
        // Another thread panicked while holding it. The probe is done; the
        // application is not.
        DISABLED.store(true, Ordering::Relaxed);
        return;
    };
    let ordinal = frame.calls.len() as u32;
    if ordinal == 0 {
        // The one call worth naming: it proves the patched crate is live,
        // which is otherwise invisible from outside the process.
        first_call_seen(type_name);
    }
    frame.calls.push(RenderCall {
        ordinal,
        type_name,
        x,
        y,
        width,
        height,
    });
}

/// Take the frame's calls and reset the buffer for the next one.
///
/// Returns an empty vector when the probe is dormant or disabled, so a caller
/// needs no separate check.
#[must_use]
pub fn take_frame() -> Vec<RenderCall> {
    if !instrumented() || DISABLED.load(Ordering::Relaxed) {
        return Vec::new();
    }
    match buffer().lock() {
        Ok(mut frame) => std::mem::take(&mut frame.calls),
        Err(_) => {
            DISABLED.store(true, Ordering::Relaxed);
            Vec::new()
        }
    }
}

/// Announce the first intercepted call, once per process.
///
/// The probe has no terminal to talk to — the application owns it — so the
/// diagnostic file is the only place an instrumented run can be seen from
/// outside. Guarded by a `OnceLock` so the render path pays one atomic read
/// per call and nothing more.
fn first_call_seen(type_name: &str) {
    static ANNOUNCED: OnceLock<()> = OnceLock::new();
    let mut announce = false;
    ANNOUNCED.get_or_init(|| {
        announce = true;
    });
    if !announce {
        return;
    }
    if let Some(log) = DebugLog::from_env("ratatui-probe") {
        log.line(
            Category::Sem,
            &format!("first render intercepted: {type_name}"),
        );
        log.close();
    }
}

/// Whether the probe is collecting. For tests and diagnostics.
#[must_use]
pub fn active() -> bool {
    instrumented() && !DISABLED.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The dormant rule reaches the innermost call: without the environment,
    /// the hook returns before touching the buffer at all.
    #[test]
    fn dormant_without_the_environment() {
        // The test process has no endpoint or token, which is the state an
        // ordinary application is in.
        assert!(!active());
        on_render("Fixture", 0, 0, 1, 1);
        assert!(take_frame().is_empty());
    }

    #[test]
    fn a_render_call_carries_what_the_framework_reported() {
        let call = RenderCall {
            ordinal: 0,
            type_name: "ratatui_widgets::paragraph::Paragraph<'_>",
            x: 1,
            y: 2,
            width: 3,
            height: 4,
        };
        // The ordinal is the only identity available, and it is frame-local.
        assert_eq!(call.ordinal, 0);
        assert!(call.type_name.contains("Paragraph"));
    }
}
