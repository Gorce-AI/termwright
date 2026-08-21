//! Author intent for custom Ratatui widgets, without replacing their render.
//!
//! [`Annotated`] implements Ratatui's ordinary [`Widget`] and
//! [`StatefulWidget`] traits and delegates to the wrapped widget exactly once.
//! The zero-config build probe still owns geometry, frame boundaries,
//! collection state and occlusion. This crate can add role, name, description,
//! test id, application-domain JSON, descriptive actions, relationships and an
//! explicit stable semantic key.
//!
//! ```
//! use ratatui::{buffer::Buffer, layout::Rect, widgets::Widget};
//! use termwright_ratatui::{Action, Annotate, Role, Semantics};
//!
//! struct Deploy;
//! impl Widget for Deploy {
//!     fn render(self, area: Rect, buffer: &mut Buffer) {
//!         "Deploy".render(area, buffer);
//!     }
//! }
//!
//! let widget = Deploy.annotated(
//!     Semantics::new()
//!         .role(Role::Button)
//!         .name("Deploy")
//!         .test_id("deploy-release")
//!         .semantic_key("deployment-control")
//!         .action(Action::Activate)
//!         .domain("deploymentStatus", "ready"),
//! );
//! # let area = Rect::new(0, 0, 10, 1);
//! # let mut buffer = Buffer::empty(area);
//! widget.render(area, &mut buffer);
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::any::type_name;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::{StatefulWidget, Widget};

pub use serde_json::{json, Value};
pub use termwright_probe_ratatui::{Action, Annotation as Semantics, Role};
pub use termwright_protocol::evidence::{
    register_pointer_evidence_provider, Context as EvidenceContext, HitTest as PointerHitTest,
    Provider as PointerEvidenceProvider, ProviderObservation as PointerEvidenceObservation,
    Registration as EvidenceRegistration,
};
pub use termwright_protocol::{
    EvidenceMethod, ProviderPointerRegion, ProviderPointerSpan, Rect as ProviderRect,
};

/// Exact Ratatui release whose traits this SDK implements.
///
/// The instrumented build launcher independently pins its core/widget patch
/// sets. Compatibility tests compare all three declarations.
pub const RATATUI_VERSION: &str = "0.30.2";

/// A widget paired with author intent.
///
/// Construction does not inspect environment variables and rendering while
/// uninstrumented is a single no-op annotation hook followed by the original
/// widget render. The inner widget remains accessible for composition and
/// tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Annotated<W> {
    widget: W,
    semantics: Semantics,
}

impl<W> Annotated<W> {
    /// Wrap a widget with semantic intent.
    #[must_use]
    pub fn new(widget: W, semantics: Semantics) -> Self {
        Self { widget, semantics }
    }

    /// Borrow the original widget.
    #[must_use]
    pub fn inner(&self) -> &W {
        &self.widget
    }

    /// Mutably borrow the original widget.
    #[must_use]
    pub fn inner_mut(&mut self) -> &mut W {
        &mut self.widget
    }

    /// Recover the original widget and discard the annotation wrapper.
    #[must_use]
    pub fn into_inner(self) -> W {
        self.widget
    }

    /// Borrow the attached author intent.
    #[must_use]
    pub fn semantics(&self) -> &Semantics {
        &self.semantics
    }
}

/// Extension trait for idiomatic `widget.annotated(semantics)` construction.
pub trait Annotate: Sized {
    /// Pair this widget with author intent without changing its render logic.
    #[must_use]
    fn annotated(self, semantics: Semantics) -> Annotated<Self> {
        Annotated::new(self, semantics)
    }
}

impl<W> Annotate for W {}

impl<W: Widget> Widget for Annotated<W> {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        let Self { widget, semantics } = self;
        attach::<Self, W>(semantics);
        Widget::render(widget, area, buffer);
    }
}

impl<W: StatefulWidget> StatefulWidget for Annotated<W> {
    type State = W::State;

    fn render(self, area: Rect, buffer: &mut Buffer, state: &mut Self::State) {
        let Self { widget, semantics } = self;
        attach::<Self, W>(semantics);
        StatefulWidget::render(widget, area, buffer, state);
    }
}

impl<'a, W> Widget for &'a Annotated<W>
where
    &'a W: Widget,
{
    fn render(self, area: Rect, buffer: &mut Buffer) {
        attach::<Self, &'a W>(self.semantics.clone());
        Widget::render(&self.widget, area, buffer);
    }
}

impl<'a, W> StatefulWidget for &'a Annotated<W>
where
    &'a W: StatefulWidget,
{
    type State = <&'a W as StatefulWidget>::State;

    fn render(self, area: Rect, buffer: &mut Buffer, state: &mut Self::State) {
        attach::<Self, &'a W>(self.semantics.clone());
        StatefulWidget::render(&self.widget, area, buffer, state);
    }
}

fn attach<Wrapper: ?Sized, Inner: ?Sized>(semantics: Semantics) {
    termwright_probe_ratatui::on_annotation(
        type_name::<Wrapper>(),
        type_name::<Inner>(),
        semantics,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    use ratatui::widgets::Paragraph;

    #[derive(Clone, Copy)]
    struct Paint(&'static str);

    impl Widget for Paint {
        fn render(self, area: Rect, buffer: &mut Buffer) {
            Paragraph::new(self.0).render(area, buffer);
        }
    }

    #[test]
    fn owned_wrapper_preserves_widget_output() {
        let area = Rect::new(0, 0, 12, 1);
        let mut expected = Buffer::empty(area);
        let mut annotated = Buffer::empty(area);

        Paint("Deploy").render(area, &mut expected);
        Paint("Deploy")
            .annotated(Semantics::new().role(Role::Button).name("Deploy"))
            .render(area, &mut annotated);

        assert_eq!(annotated, expected);
    }

    struct Counter;

    impl StatefulWidget for Counter {
        type State = usize;

        fn render(self, area: Rect, buffer: &mut Buffer, state: &mut Self::State) {
            *state += 1;
            Paragraph::new(state.to_string()).render(area, buffer);
        }
    }

    #[test]
    fn stateful_wrapper_delegates_the_same_state_once() {
        let area = Rect::new(0, 0, 4, 1);
        let mut expected = Buffer::empty(area);
        let mut annotated = Buffer::empty(area);
        let mut expected_state = 0;
        let mut annotated_state = 0;

        Counter.render(area, &mut expected, &mut expected_state);
        Counter
            .annotated(Semantics::new().test_id("counter"))
            .render(area, &mut annotated, &mut annotated_state);

        assert_eq!(annotated, expected);
        assert_eq!(annotated_state, expected_state);
        assert_eq!(annotated_state, 1);
    }

    struct RefPaint;

    impl Widget for &RefPaint {
        fn render(self, area: Rect, buffer: &mut Buffer) {
            Paragraph::new("reference").render(area, buffer);
        }
    }

    #[test]
    fn reference_render_keeps_reference_widget_behavior() {
        let area = Rect::new(0, 0, 12, 1);
        let wrapped = RefPaint.annotated(Semantics::new().name("Reference"));
        let mut buffer = Buffer::empty(area);

        Widget::render(&wrapped, area, &mut buffer);

        assert_eq!(buffer[(0, 0)].symbol(), "r");
    }

    struct RefCounter;

    impl StatefulWidget for &RefCounter {
        type State = usize;

        fn render(self, area: Rect, buffer: &mut Buffer, state: &mut Self::State) {
            *state += 1;
            Paragraph::new(state.to_string()).render(area, buffer);
        }
    }

    #[test]
    fn reference_stateful_render_delegates_the_same_state_once() {
        let area = Rect::new(0, 0, 4, 1);
        let wrapped = RefCounter.annotated(Semantics::new().test_id("ref-counter"));
        let mut buffer = Buffer::empty(area);
        let mut state = 0;

        StatefulWidget::render(&wrapped, area, &mut buffer, &mut state);

        assert_eq!(buffer[(0, 0)].symbol(), "1");
        assert_eq!(state, 1);
    }

    #[test]
    fn manifest_floor_matches_the_pinned_framework_floor() {
        assert_eq!(env!("CARGO_PKG_RUST_VERSION"), "1.88");
        assert_eq!(RATATUI_VERSION, "0.30.2");
        let manifest = include_str!("../Cargo.toml");
        assert!(manifest.contains("ratatui = { version = \"=0.30.2\""));
    }
}
