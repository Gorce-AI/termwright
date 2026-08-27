//! What a patched `ratatui-core` calls, and what it is allowed to claim.
//!
//! Ratatui is immediate mode. There is no retained tree, no widget that
//! outlives the call that drew it, and no record of which widget owns which
//! cell. The Phase 0 audit (`docs/architecture/audit/ratatui.md`) settled what
//! follows from that, and this crate is written to respect it rather than to
//! paper over it:
//!
//! - **Identity is frame-local by default.** `Widget::render` takes `self` by
//!   value, so the widget is consumed by the call and nothing survives to be
//!   named again. Ordinals within a frame are honest; a custom widget may opt
//!   into an explicit author-owned semantic key, but the probe never invents
//!   one for ordinary widgets.
//! - **`area` is intent, not ownership.** A later write silently wins and
//!   nothing records that it happened, so the rectangle a widget was drawn
//!   into is not the cells it ended up with. It is reported as the intended
//!   rectangle and never as a visible one.
//! - **Paint order is unavailable**, so the snapshot reports pointer hit-grid
//!   support as unavailable. Intended geometry is never promoted to pointer
//!   ownership.
//!
//! The crate is deliberately small. It is a hook, a buffer of what one frame
//! contained, and the protocol client — everything that needs `std`, kept out
//! of the `no_std` crate that calls it.

pub mod launch;
pub mod patchset;
pub mod session;
pub mod tree;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use serde_json::Value;
use termwright_protocol::client::{ENV_ENDPOINT, ENV_TOKEN};
use termwright_protocol::{
    ProbeIdentityKind, ProbeInfo, ProbeInjectionTier, ProbeInstrumentation, ProbeSemanticClass,
};

pub use termwright_protocol::{Action, Role};

/// Author intent attached to one immediate-mode render call.
///
/// This type deliberately cannot carry bounds, focus, visibility, cells or
/// collection state. Those facts belong to the framework and the terminal.
/// Its actions are descriptive members of the protocol's closed vocabulary,
/// not callbacks. `extended` is application-domain JSON only; keys that happen
/// to be named `bounds`, `state` or `actions` remain nested domain data and are
/// never promoted into protocol fields.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Annotation {
    /// Semantic role chosen by the application author.
    pub role: Option<Role>,
    /// Accessible name chosen by the application author.
    pub name: Option<String>,
    /// Longer author description.
    pub description: Option<String>,
    /// Stable selector/correlation hint. Never promoted to node identity.
    pub test_id: Option<String>,
    /// Explicit application-domain JSON state.
    pub extended: BTreeMap<String, Value>,
    /// Descriptive protocol actions. They are capability hints, never callbacks.
    pub actions: Vec<Action>,
    /// Semantic keys of nodes that label this node in the same frame.
    pub labelled_by: Vec<String>,
    /// Semantic keys of nodes that describe this node in the same frame.
    pub described_by: Vec<String>,
    /// Author-owned identity for a value recreated on every frame.
    pub semantic_key: Option<String>,
}

impl Annotation {
    /// Start with no asserted intent.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the semantic role.
    #[must_use]
    pub fn role(mut self, role: Role) -> Self {
        self.role = Some(role);
        self
    }

    /// Set the accessible name.
    #[must_use]
    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Set the longer description.
    #[must_use]
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Set the stable selector/correlation hint.
    ///
    /// Ratatui still has frame-local identity. The value becomes `testId`, so
    /// locators may use it and consumers may correlate deliberately, but the
    /// node id and handshake remain frame-local.
    #[must_use]
    pub fn test_id(mut self, test_id: impl Into<String>) -> Self {
        self.test_id = Some(test_id.into());
        self
    }

    /// Add one application-domain JSON value.
    #[must_use]
    pub fn domain(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.extended.insert(key.into(), value.into());
        self
    }

    /// Replace the complete application-domain JSON object.
    #[must_use]
    pub fn extended(mut self, extended: BTreeMap<String, Value>) -> Self {
        self.extended = extended;
        self
    }

    /// Add one descriptive action from the protocol's closed vocabulary.
    ///
    /// The driver still performs the corresponding real terminal input; this
    /// never registers or invokes an application callback.
    #[must_use]
    pub fn action(mut self, action: Action) -> Self {
        if !self.actions.contains(&action) {
            self.actions.push(action);
        }
        self
    }

    /// Relate this node to the node carrying `semantic_key` as its label.
    #[must_use]
    pub fn labelled_by(mut self, semantic_key: impl Into<String>) -> Self {
        self.labelled_by.push(semantic_key.into());
        self
    }

    /// Relate this node to the node carrying `semantic_key` as its description.
    #[must_use]
    pub fn described_by(mut self, semantic_key: impl Into<String>) -> Self {
        self.described_by.push(semantic_key.into());
        self
    }

    /// Give this annotated render call stable author-owned identity.
    ///
    /// A key must be unique among the frame's annotated widgets. Duplicate or
    /// empty keys safely degrade to frame-local ids rather than invalidating
    /// the snapshot or picking a winner by render order.
    #[must_use]
    pub fn semantic_key(mut self, semantic_key: impl Into<String>) -> Self {
        self.semantic_key = Some(semantic_key.into());
        self
    }
}

/// What a collection widget reported about its own contents.
///
/// Read *after* the widget rendered, which is the only time it is true:
/// rendering mutates the state to reflect what was actually drawn — `List`
/// assigns `state.offset = first_visible_index` partway through — so a
/// pre-render read would report what the application asked for rather than
/// what the user is looking at.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Collection {
    /// Highlighted row, if any. An index into the widget's own items.
    pub selected: Option<usize>,
    /// First visible row after the widget clamped it.
    pub offset: usize,
    /// How many items the widget holds.
    pub item_count: usize,
    /// Item text, in order, capped at [`MAX_ITEMS`].
    pub items: Vec<String>,
}

/// How many items of a collection the probe will carry per frame.
///
/// A list can hold more rows than a terminal will ever show, and every one of
/// them would be allocated, copied and validated on every frame. The cap is
/// generous enough for a test to find what it is looking for and small enough
/// that a hundred-thousand-row table costs nothing.
pub const MAX_ITEMS: usize = 200;

/// One `render_widget` call, as the patched crate reported it.
///
/// `type_name` is what `core::any::type_name` produced — a path like
/// `ratatui_widgets::paragraph::Paragraph<'_>` for a built-in, or the
/// application's own type for a custom widget. A hint, never a role.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderCall {
    /// Position in this frame's call stream. Meaningful only within the frame.
    pub ordinal: u32,
    /// Enclosing annotated render call when actual call nesting proves it.
    pub parent_ordinal: Option<u32>,
    pub type_name: &'static str,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// Present when the widget is a collection that reported its contents.
    pub collection: Option<Collection>,
    /// Author intent supplied by `termwright-ratatui`, when the exact wrapper
    /// was rendered through the intercepted `Frame` entry point.
    pub annotation: Option<Annotation>,
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

#[derive(Debug, Default)]
struct FrameContext {
    buffer: FrameBuffer,
    annotated_stack: Vec<u32>,
}

thread_local! {
    // A terminal draw is synchronous and its widget calls stay on the drawing
    // thread. Keeping a stack per thread makes concurrent Terminals independent
    // and lets a nested try_draw retain the suspended outer frame without a
    // process-wide render mutex.
    static FRAME_STACK: RefCell<Vec<FrameContext>> = const { RefCell::new(Vec::new()) };
}

fn with_current_frame<R>(operation: impl FnOnce(&mut FrameContext) -> R) -> Option<R> {
    FRAME_STACK.with(|stack| {
        let Ok(mut stack) = stack.try_borrow_mut() else {
            DISABLED.store(true, Ordering::Release);
            return None;
        };
        stack.last_mut().map(operation)
    })
}

/// Owns one synchronous Ratatui render context on the current thread.
pub struct FrameGuard {
    active: bool,
}

/// Begin one certified `Terminal::try_draw` lifecycle.
#[must_use]
pub fn begin_frame() -> FrameGuard {
    if !instrumented() || DISABLED.load(Ordering::Relaxed) {
        return FrameGuard { active: false };
    }
    let active = FRAME_STACK.with(|stack| match stack.try_borrow_mut() {
        Ok(mut stack) => {
            stack.push(FrameContext::default());
            true
        }
        Err(_) => {
            DISABLED.store(true, Ordering::Release);
            false
        }
    });
    FrameGuard { active }
}

impl Drop for FrameGuard {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        FRAME_STACK.with(|stack| match stack.try_borrow_mut() {
            Ok(mut stack) => {
                if stack.pop().is_none() {
                    DISABLED.store(true, Ordering::Release);
                }
            }
            Err(_) => DISABLED.store(true, Ordering::Release),
        });
    }
}

/// Whether the current thread is inside the certified full-frame lifecycle.
pub fn frame_guard_active() -> bool {
    FRAME_STACK.with(|stack| {
        stack
            .try_borrow()
            .map(|stack| !stack.is_empty())
            .unwrap_or(false)
    })
}

/// RAII boundary for one authoritative `Annotated<W>` render call.
pub struct AnnotatedRenderGuard {
    ordinal: Option<u32>,
}

impl Drop for AnnotatedRenderGuard {
    fn drop(&mut self) {
        let Some(expected) = self.ordinal else { return };
        if with_current_frame(|frame| frame.annotated_stack.pop()) != Some(Some(expected)) {
            DISABLED.store(true, Ordering::Relaxed);
        }
    }
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
    if !frame_guard_active() {
        return;
    }
    let _ = with_current_frame(|frame| {
        let ordinal = frame.buffer.calls.len() as u32;
        frame.buffer.calls.push(RenderCall {
            ordinal,
            parent_ordinal: None,
            type_name,
            x,
            y,
            width,
            height,
            collection: None,
            annotation: None,
        });
    });
}

/// Begin an annotated render, including direct `Widget::render` calls.
///
/// An exact Frame hook for the same wrapper/area is claimed rather than
/// duplicated. Otherwise the wrapper contributes the render fact itself.
#[must_use]
pub fn begin_annotated_render(
    wrapper_type_name: &'static str,
    widget_type_name: &'static str,
    annotation: Annotation,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) -> AnnotatedRenderGuard {
    if !instrumented() || DISABLED.load(Ordering::Relaxed) {
        return AnnotatedRenderGuard { ordinal: None };
    }
    if !frame_guard_active() {
        return AnnotatedRenderGuard { ordinal: None };
    }
    let Some(ordinal) = with_current_frame(|frame| {
        let parent_ordinal = frame.annotated_stack.last().copied();
        let ordinal = record_annotated_call(
            &mut frame.buffer,
            parent_ordinal,
            wrapper_type_name,
            widget_type_name,
            annotation,
            x,
            y,
            width,
            height,
        );
        frame.annotated_stack.push(ordinal);
        ordinal
    }) else {
        return AnnotatedRenderGuard { ordinal: None };
    };
    AnnotatedRenderGuard {
        ordinal: Some(ordinal),
    }
}

#[allow(clippy::too_many_arguments)]
fn record_annotated_call(
    frame: &mut FrameBuffer,
    parent_ordinal: Option<u32>,
    wrapper_type_name: &'static str,
    widget_type_name: &'static str,
    annotation: Annotation,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) -> u32 {
    let existing = frame.calls.last_mut().filter(|call| {
        call.type_name == wrapper_type_name
            && call.annotation.is_none()
            && call.x == x
            && call.y == y
            && call.width == width
            && call.height == height
    });
    if let Some(call) = existing {
        call.type_name = widget_type_name;
        call.annotation = Some(annotation);
        call.parent_ordinal = parent_ordinal;
        call.ordinal
    } else {
        let ordinal = frame.calls.len() as u32;
        frame.calls.push(RenderCall {
            ordinal,
            parent_ordinal,
            type_name: widget_type_name,
            x,
            y,
            width,
            height,
            collection: None,
            annotation: Some(annotation),
        });
        ordinal
    }
}

/// Called by a patched `ratatui-widgets` once a collection has rendered.
///
/// Attaches to the call the core hook recorded a moment earlier: rendering is
/// sequential, so the widget currently drawing is the last one announced. The
/// two hooks are in different crates because that is where the two facts live
/// — `ratatui-core` sees every call but cannot name the state type
/// (`StatefulWidget::State` is `?Sized`, so it cannot even be downcast), while
/// `ratatui-widgets` knows the concrete `ListState` and can read the items
/// themselves.
pub fn on_collection(selected: Option<usize>, offset: usize, item_count: usize, items: &[String]) {
    if !instrumented() || DISABLED.load(Ordering::Relaxed) {
        return;
    }
    if !frame_guard_active() {
        return;
    }
    let _ = with_current_frame(|frame| {
        let Some(call) = frame.buffer.calls.last_mut() else {
            // A collection rendered without the call being announced first.
            // Not a shape we can attribute, so it is dropped rather than
            // guessed at.
            return;
        };
        call.collection = Some(Collection {
            selected,
            offset,
            item_count,
            items: items.iter().take(MAX_ITEMS).cloned().collect(),
        });
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
    with_current_frame(|frame| std::mem::take(&mut frame.buffer.calls)).unwrap_or_default()
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
            parent_ordinal: None,
            type_name: "ratatui_widgets::paragraph::Paragraph<'_>",
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            collection: None,
            annotation: None,
        };
        // The ordinal is the only identity available, and it is frame-local.
        assert_eq!(call.ordinal, 0);
        assert!(call.type_name.contains("Paragraph"));
    }

    #[test]
    fn direct_and_frame_announced_annotations_have_one_truthful_call() {
        let mut frame = FrameBuffer {
            calls: vec![RenderCall {
                ordinal: 0,
                parent_ordinal: None,
                type_name: "my_app::Outer",
                x: 1,
                y: 2,
                width: 3,
                height: 4,
                collection: None,
                annotation: None,
            }],
        };

        let direct = record_annotated_call(
            &mut frame,
            Some(0),
            "termwright_ratatui::Annotated<my_app::Inner>",
            "my_app::Inner",
            Annotation::new().name("nested"),
            5,
            6,
            7,
            8,
        );
        assert_eq!(frame.calls[0].type_name, "my_app::Outer");
        assert!(frame.calls[0].annotation.is_none());
        assert_eq!(direct, 1);
        assert_eq!(frame.calls[1].parent_ordinal, Some(0));

        frame.calls.push(RenderCall {
            ordinal: 2,
            parent_ordinal: None,
            type_name: "termwright_ratatui::Annotated<my_app::Button>",
            x: 9,
            y: 10,
            width: 11,
            height: 12,
            collection: None,
            annotation: None,
        });
        let claimed = record_annotated_call(
            &mut frame,
            Some(1),
            "termwright_ratatui::Annotated<my_app::Button>",
            "my_app::Button",
            Annotation::new().name("claimed"),
            9,
            10,
            11,
            12,
        );
        assert_eq!(claimed, 2);
        assert_eq!(frame.calls.len(), 3);
        assert_eq!(frame.calls[2].type_name, "my_app::Button");
        assert_eq!(frame.calls[2].parent_ordinal, Some(1));
        assert_eq!(
            frame.calls[2]
                .annotation
                .as_ref()
                .and_then(|annotation| annotation.name.as_deref()),
            Some("claimed")
        );
    }

    #[test]
    fn nested_frame_contexts_suspend_and_restore_the_outer_frame() {
        FRAME_STACK.with(|stack| {
            let mut stack = stack.borrow_mut();
            assert!(stack.is_empty());
            stack.push(FrameContext::default());
        });
        with_current_frame(|frame| {
            frame.buffer.calls.push(RenderCall {
                ordinal: 0,
                parent_ordinal: None,
                type_name: "Outer",
                x: 0,
                y: 0,
                width: 10,
                height: 2,
                collection: None,
                annotation: None,
            });
        });
        FRAME_STACK.with(|stack| stack.borrow_mut().push(FrameContext::default()));
        with_current_frame(|frame| {
            frame.buffer.calls.push(RenderCall {
                ordinal: 0,
                parent_ordinal: None,
                type_name: "Inner",
                x: 1,
                y: 1,
                width: 4,
                height: 1,
                collection: None,
                annotation: None,
            });
        });

        let inner = with_current_frame(|frame| std::mem::take(&mut frame.buffer.calls))
            .expect("inner frame");
        assert_eq!(inner.len(), 1);
        assert_eq!(inner[0].type_name, "Inner");
        FRAME_STACK.with(|stack| {
            stack.borrow_mut().pop().expect("inner context");
        });
        let outer = with_current_frame(|frame| std::mem::take(&mut frame.buffer.calls))
            .expect("restored outer frame");
        assert_eq!(outer.len(), 1);
        assert_eq!(outer[0].type_name, "Outer");
        FRAME_STACK.with(|stack| {
            stack.borrow_mut().pop().expect("outer context");
            assert!(stack.borrow().is_empty());
        });
    }
}

/// What this probe tells the driver it can observe.
///
/// The interesting part is what is absent. Ratatui offers no stable identity,
/// no computed visible rectangle and no paint order, so none of those
/// capabilities is claimed. Optional author annotations are supported through
/// `termwright-ratatui`; they add intent without changing physical facts. A
/// driver that negotiates against
/// this gets an accurate picture of a framework that can be read but not
/// pointed at, rather than a floor it has to guess at.
///
/// `operations` *is* claimed: an immediate-mode frame is a call stream, and
/// that stream is the only structure there is.
#[must_use]
pub fn probe_info(framework_version: Option<&str>) -> ProbeInfo {
    ProbeInfo {
        framework: "ratatui".to_owned(),
        framework_version: framework_version.map(str::to_owned),
        probe_version: env!("CARGO_PKG_VERSION").to_owned(),
        identity_kind: ProbeIdentityKind::FrameLocal,
        capabilities: vec![
            "intended-rect".to_owned(),
            "operations".to_owned(),
            "annotations".to_owned(),
        ],
        instrumentation: Some(ProbeInstrumentation {
            highest_tier: ProbeInjectionTier::T3,
            semantic_class: ProbeSemanticClass::A,
            degraded_capabilities: vec![],
        }),
    }
}

#[cfg(test)]
mod handshake_tests {
    use super::*;

    /// The declaration must not promise anything the framework cannot do.
    ///
    /// Each absent capability is a fact from the Phase 0 audit: identity dies
    /// with the frame, no visible rectangle is computed anywhere and paint
    /// order is not exposed. The separate SDK supplies author intent.
    #[test]
    fn it_claims_only_what_ratatui_gives() {
        let declared = serde_json::to_string(&probe_info(Some("0.30.2"))).expect("serialises");
        assert!(
            declared.contains("\"identityKind\":\"frame-local\""),
            "{declared}"
        );
        for absent in [
            "stable-identity",
            "visible-rect",
            "paint-order",
            "frame-begin",
        ] {
            assert!(
                !declared.contains(absent),
                "claimed {absent}, which Ratatui does not provide: {declared}"
            );
        }
        assert!(declared.contains("\"operations\""), "{declared}");
        assert!(declared.contains("\"annotations\""), "{declared}");
        assert!(declared.contains("\"highestTier\":\"T3\""), "{declared}");
        assert!(declared.contains("\"semanticClass\":\"A\""), "{declared}");
        assert!(declared.contains("0.30.2"), "{declared}");
    }

    #[test]
    fn the_framework_version_is_optional() {
        let declared = serde_json::to_string(&probe_info(None)).expect("serialises");
        assert!(!declared.contains("frameworkVersion"), "{declared}");
    }
}
