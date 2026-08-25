use std::sync::Arc;

use termwright_protocol::evidence::{
    Context, InputModeProvider, PaintProvider, Registry, ScrollProvider,
};
use termwright_protocol::{
    EvidenceMethod, Orientation, ProviderPaintedRegion, ProviderPointerSpan, ProviderScrollState,
    ProviderTerminalInputModes, Rect,
};

#[derive(Debug)]
struct ProductionViewport;

impl ScrollProvider for ProductionViewport {
    fn id(&self) -> &str {
        "app.viewport"
    }

    fn version(&self) -> &str {
        "1"
    }

    fn method(&self) -> EvidenceMethod {
        EvidenceMethod::Native
    }

    fn observe(&self, context: &Context) -> Result<Vec<ProviderScrollState>, String> {
        Ok(vec![ProviderScrollState {
            recipient_id: "list".into(),
            axis: Orientation::Vertical,
            offset: context.revision,
            viewport: 4,
            extent: 20,
        }])
    }
}

#[test]
fn scroll_is_a_closed_application_evidence_family() {
    let registry = Registry::new();
    let registration = registry.register_scroll(Arc::new(ProductionViewport));
    assert!(registration.is_ok());

    let duplicate = registry.register_scroll(Arc::new(ProductionViewport));
    assert_eq!(duplicate.unwrap_err(), "duplicate provider app.viewport");
}

#[derive(Debug)]
struct ProductionPainter;

impl PaintProvider for ProductionPainter {
    fn id(&self) -> &str {
        "app.paint"
    }
    fn version(&self) -> &str {
        "1"
    }
    fn method(&self) -> EvidenceMethod {
        EvidenceMethod::Native
    }

    fn observe(&self, _context: &Context) -> Result<Vec<ProviderPaintedRegion>, String> {
        Ok(vec![ProviderPaintedRegion {
            recipient_id: "list".into(),
            region_bounds: Rect::new(2, 3, 4, 2),
            spans: vec![
                ProviderPointerSpan {
                    row: 2,
                    from: 3,
                    to: 7,
                },
                ProviderPointerSpan {
                    row: 3,
                    from: 4,
                    to: 6,
                },
            ],
        }])
    }
}

#[test]
fn paint_is_a_closed_application_evidence_family() {
    let registry = Registry::new();
    assert!(registry.register_paint(Arc::new(ProductionPainter)).is_ok());
    assert_eq!(
        registry
            .register_paint(Arc::new(ProductionPainter))
            .unwrap_err(),
        "duplicate provider app.paint",
    );
}

#[derive(Debug)]
struct ProductionInputParser;

impl InputModeProvider for ProductionInputParser {
    fn id(&self) -> &str {
        "app.input"
    }
    fn version(&self) -> &str {
        "1"
    }
    fn method(&self) -> EvidenceMethod {
        EvidenceMethod::Native
    }
    fn observe(&self, _context: &Context) -> Result<ProviderTerminalInputModes, String> {
        Ok(ProviderTerminalInputModes {
            mouse_tracking: "drag".into(),
            mouse_encoding: "sgr".into(),
            focus_reporting: "on".into(),
        })
    }
}

#[test]
fn input_modes_are_a_closed_application_evidence_family() {
    let registry = Registry::new();
    assert!(registry
        .register_input_modes(Arc::new(ProductionInputParser))
        .is_ok());
    assert_eq!(
        registry
            .register_input_modes(Arc::new(ProductionInputParser))
            .unwrap_err(),
        "duplicate provider app.input",
    );
}
