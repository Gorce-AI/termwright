//! Session-scoped application evidence providers.

use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};

use crate::messages::EvidenceProviderRegistration;
use crate::tree::{
    EvidenceMethod, EvidenceProvenance, EvidenceSource, EvidenceStrength, PointerHitGrid,
    PointerHitRegion, ProviderActionRecipes, ProviderFocusState, ProviderPaintedRegion,
    ProviderPointerRegion, ProviderRevisionEvidence, ProviderScrollState,
    ProviderTerminalInputModes, Rect,
};

/// Immutable coordinates identifying the provider observation being requested.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Context {
    /// Session whose frozen contract contains this provider.
    pub session_id: String,
    /// Semantic revision the evidence must describe exactly.
    pub revision: i64,
    /// Committed terminal viewport width in cells.
    pub columns: i64,
    /// Committed terminal viewport height in cells.
    pub rows: i64,
}

/// Exact production pointer-router facts returned for one revision.
pub struct PointerObservation {
    /// Canonical pointer-owned regions for semantic recipients.
    pub pointer_regions: Vec<ProviderPointerRegion>,
    /// Optional production hit-test used to verify the complete viewport.
    pub hit_test: Option<HitTest>,
}

/// Thread-safe production pointer hit-test in `(column, row)` order.
pub type HitTest = Arc<dyn Fn(i64, i64) -> Option<String> + Send + Sync>;

/// Closed application provider family for production pointer evidence.
pub trait PointerProvider: Debug + Send + Sync {
    /// Stable provider identity frozen into the session contract.
    fn id(&self) -> &str;
    /// Provider implementation version.
    fn version(&self) -> &str;
    /// How the application obtains the evidence.
    fn method(&self) -> EvidenceMethod;
    /// Closed provider capability names advertised during negotiation.
    /// `pointer-regions` and `hit-test` may be owned together or by two
    /// independent providers, but each capability has one session owner.
    fn capabilities(&self) -> Vec<String>;
    /// Observe exact evidence for the requested session revision.
    fn observe(&self, context: &Context) -> Result<PointerObservation, String>;
}

/// Closed application provider family for data-only physical input recipes.
pub trait ActionStrategyProvider: Debug + Send + Sync {
    /// Stable provider identity frozen into the session contract.
    fn id(&self) -> &str;
    /// Provider implementation version.
    fn version(&self) -> &str;
    /// How the application obtains the production recipes.
    fn method(&self) -> EvidenceMethod;
    /// Observe exact recipes for the requested session revision.
    fn observe(&self, context: &Context) -> Result<Vec<ProviderActionRecipes>, String>;
}

/// Closed application provider family for the production focus manager.
pub trait FocusProvider: Debug + Send + Sync {
    /// Stable provider identity frozen into the session contract.
    fn id(&self) -> &str;
    /// Provider implementation version.
    fn version(&self) -> &str;
    /// How the application obtains the focus evidence.
    fn method(&self) -> EvidenceMethod;
    /// Focused semantic recipient, or `None` when no node owns focus.
    fn observe(&self, context: &Context) -> Result<Option<String>, String>;
}

/// Closed provider family for the production application viewport model.
pub trait ScrollProvider: Debug + Send + Sync {
    /// Stable provider identity frozen into the session contract.
    fn id(&self) -> &str;
    /// Provider implementation version.
    fn version(&self) -> &str;
    /// How the application obtains viewport evidence.
    fn method(&self) -> EvidenceMethod;
    /// Complete scroll recipient states for this committed revision.
    fn observe(&self, context: &Context) -> Result<Vec<ProviderScrollState>, String>;
}

/// Closed provider family for production painter attribution.
pub trait PaintProvider: Debug + Send + Sync {
    /// Stable provider identity frozen into the session contract.
    fn id(&self) -> &str;
    /// Provider implementation version.
    fn version(&self) -> &str;
    /// How the application obtains painter evidence.
    fn method(&self) -> EvidenceMethod;
    /// Complete painted regions for this committed revision.
    fn observe(&self, context: &Context) -> Result<Vec<ProviderPaintedRegion>, String>;
}

/// Closed provider family for production terminal parser configuration.
pub trait InputModeProvider: Debug + Send + Sync {
    /// Stable provider identity frozen into the session contract.
    fn id(&self) -> &str;
    /// Provider implementation version.
    fn version(&self) -> &str;
    /// How the application obtains parser evidence.
    fn method(&self) -> EvidenceMethod;
    /// Exact production parser configuration for this committed revision.
    fn observe(&self, context: &Context) -> Result<ProviderTerminalInputModes, String>;
}

trait Provider: Debug + Send + Sync {
    fn id(&self) -> &str;
    fn version(&self) -> &str;
    fn method(&self) -> EvidenceMethod;
    fn capabilities(&self) -> Vec<String>;
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String>;
}

struct ProviderObservation {
    pointer_regions: Vec<ProviderPointerRegion>,
    hit_test: Option<HitTest>,
    action_recipes: Option<Vec<ProviderActionRecipes>>,
    focus_state: Option<ProviderFocusState>,
    scroll_states: Option<Vec<ProviderScrollState>>,
    painted_regions: Option<Vec<ProviderPaintedRegion>>,
    input_modes: Option<ProviderTerminalInputModes>,
}

#[derive(Debug)]
struct PointerProviderAdapter(Arc<dyn PointerProvider>);
impl Provider for PointerProviderAdapter {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn version(&self) -> &str {
        self.0.version()
    }
    fn method(&self) -> EvidenceMethod {
        self.0.method()
    }
    fn capabilities(&self) -> Vec<String> {
        self.0.capabilities()
    }
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String> {
        let value = self.0.observe(context)?;
        Ok(ProviderObservation {
            pointer_regions: value.pointer_regions,
            hit_test: value.hit_test,
            action_recipes: None,
            focus_state: None,
            scroll_states: None,
            painted_regions: None,
            input_modes: None,
        })
    }
}

#[derive(Debug)]
struct ActionStrategyProviderAdapter(Arc<dyn ActionStrategyProvider>);
impl Provider for ActionStrategyProviderAdapter {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn version(&self) -> &str {
        self.0.version()
    }
    fn method(&self) -> EvidenceMethod {
        self.0.method()
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["action-recipes".into()]
    }
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String> {
        Ok(ProviderObservation {
            pointer_regions: Vec::new(),
            hit_test: None,
            action_recipes: Some(self.0.observe(context)?),
            focus_state: None,
            scroll_states: None,
            painted_regions: None,
            input_modes: None,
        })
    }
}

#[derive(Debug)]
struct FocusProviderAdapter(Arc<dyn FocusProvider>);
impl Provider for FocusProviderAdapter {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn version(&self) -> &str {
        self.0.version()
    }
    fn method(&self) -> EvidenceMethod {
        self.0.method()
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["focus-state".into()]
    }
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String> {
        Ok(ProviderObservation {
            pointer_regions: Vec::new(),
            hit_test: None,
            action_recipes: None,
            focus_state: Some(match self.0.observe(context)? {
                Some(recipient_id) => ProviderFocusState::Focused { recipient_id },
                None => ProviderFocusState::None,
            }),
            scroll_states: None,
            painted_regions: None,
            input_modes: None,
        })
    }
}

#[derive(Debug)]
struct ScrollProviderAdapter(Arc<dyn ScrollProvider>);
impl Provider for ScrollProviderAdapter {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn version(&self) -> &str {
        self.0.version()
    }
    fn method(&self) -> EvidenceMethod {
        self.0.method()
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["scroll-state".into()]
    }
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String> {
        Ok(ProviderObservation {
            pointer_regions: Vec::new(),
            hit_test: None,
            action_recipes: None,
            focus_state: None,
            scroll_states: Some(self.0.observe(context)?),
            painted_regions: None,
            input_modes: None,
        })
    }
}

#[derive(Debug)]
struct PaintProviderAdapter(Arc<dyn PaintProvider>);
impl Provider for PaintProviderAdapter {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn version(&self) -> &str {
        self.0.version()
    }
    fn method(&self) -> EvidenceMethod {
        self.0.method()
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["painted-regions".into()]
    }
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String> {
        Ok(ProviderObservation {
            pointer_regions: Vec::new(),
            hit_test: None,
            action_recipes: None,
            focus_state: None,
            scroll_states: None,
            painted_regions: Some(self.0.observe(context)?),
            input_modes: None,
        })
    }
}

#[derive(Debug)]
struct InputModeProviderAdapter(Arc<dyn InputModeProvider>);
impl Provider for InputModeProviderAdapter {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn version(&self) -> &str {
        self.0.version()
    }
    fn method(&self) -> EvidenceMethod {
        self.0.method()
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["terminal-input-modes".into()]
    }
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String> {
        Ok(ProviderObservation {
            pointer_regions: Vec::new(),
            hit_test: None,
            action_recipes: None,
            focus_state: None,
            scroll_states: None,
            painted_regions: None,
            input_modes: Some(self.0.observe(context)?),
        })
    }
}

#[derive(Debug)]
struct Entry {
    provider: Arc<dyn Provider>,
    capabilities: Vec<String>,
    active: AtomicBool,
}
#[derive(Debug, Default)]
struct State {
    active_leases: usize,
    entries: HashMap<String, Arc<Entry>>,
}

/// Session-scoped registry frozen independently by each protocol client.
#[derive(Debug, Clone, Default)]
pub struct Registry {
    state: Arc<Mutex<State>>,
}

/// Handle whose disposal marks a negotiated provider as lost.
#[derive(Debug)]
pub struct Registration {
    state: Arc<Mutex<State>>,
    id: String,
    entry: Arc<Entry>,
}
impl Registration {
    /// Remove the provider and fail closed for leases that already froze it.
    pub fn dispose(&self) {
        self.entry.active.store(false, Ordering::SeqCst);
        self.state
            .lock()
            .expect("evidence registry poisoned")
            .entries
            .remove(&self.id);
    }
}

impl Registry {
    /// Create an empty provider registry.
    pub fn new() -> Self {
        Self::default()
    }
    /// Register a provider before any session freezes the registry.
    /// Register a production pointer provider before contract freeze.
    pub fn register_pointer(
        &self,
        provider: Arc<dyn PointerProvider>,
    ) -> Result<Registration, String> {
        for capability in provider.capabilities() {
            if capability != "pointer-regions" && capability != "hit-test" {
                return Err(format!("pointer provider cannot declare {capability}"));
            }
        }
        self.register(Arc::new(PointerProviderAdapter(provider)))
    }

    /// Register production physical input recipes before contract freeze.
    pub fn register_action_strategies(
        &self,
        provider: Arc<dyn ActionStrategyProvider>,
    ) -> Result<Registration, String> {
        self.register(Arc::new(ActionStrategyProviderAdapter(provider)))
    }

    /// Register production focus-manager evidence before contract freeze.
    pub fn register_focus(&self, provider: Arc<dyn FocusProvider>) -> Result<Registration, String> {
        self.register(Arc::new(FocusProviderAdapter(provider)))
    }

    /// Register production viewport evidence before contract freeze.
    pub fn register_scroll(
        &self,
        provider: Arc<dyn ScrollProvider>,
    ) -> Result<Registration, String> {
        self.register(Arc::new(ScrollProviderAdapter(provider)))
    }

    /// Register production painter attribution before contract freeze.
    pub fn register_paint(&self, provider: Arc<dyn PaintProvider>) -> Result<Registration, String> {
        self.register(Arc::new(PaintProviderAdapter(provider)))
    }

    /// Register production terminal parser configuration before contract freeze.
    pub fn register_input_modes(
        &self,
        provider: Arc<dyn InputModeProvider>,
    ) -> Result<Registration, String> {
        self.register(Arc::new(InputModeProviderAdapter(provider)))
    }

    fn register(&self, provider: Arc<dyn Provider>) -> Result<Registration, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "evidence registry poisoned".to_owned())?;
        if state.active_leases > 0 {
            return Err(format!(
                "provider {} registered after contract freeze",
                provider.id()
            ));
        }
        if provider.id().is_empty() || provider.version().is_empty() {
            return Err("invalid provider identity".into());
        }
        if state.entries.contains_key(provider.id()) {
            return Err(format!("duplicate provider {}", provider.id()));
        }
        let capabilities = provider.capabilities();
        validate_capabilities(&capabilities)?;
        let id = provider.id().to_owned();
        let entry = Arc::new(Entry {
            provider,
            capabilities,
            active: AtomicBool::new(true),
        });
        state.entries.insert(id.clone(), entry.clone());
        Ok(Registration {
            state: self.state.clone(),
            id,
            entry,
        })
    }
    pub(crate) fn freeze(&self) -> Lease {
        let mut state = self.state.lock().expect("evidence registry poisoned");
        state.active_leases += 1;
        Lease {
            state: self.state.clone(),
            entries: state.entries.values().cloned().collect(),
            closed: false,
        }
    }
}

fn validate_capabilities(capabilities: &[String]) -> Result<(), String> {
    if capabilities.is_empty() {
        return Err("provider must declare at least one capability".into());
    }
    let mut seen = std::collections::HashSet::new();
    for capability in capabilities {
        if capability != "pointer-regions"
            && capability != "hit-test"
            && capability != "action-recipes"
            && capability != "focus-state"
            && capability != "scroll-state"
            && capability != "painted-regions"
            && capability != "terminal-input-modes"
        {
            return Err(format!("unknown provider capability {capability}"));
        }
        if !seen.insert(capability) {
            return Err(format!("duplicate provider capability {capability}"));
        }
    }
    Ok(())
}

/// Process-wide registry used by framework probes and ordinary single-app binaries.
/// Providers must register before the first instrumented frame freezes it.
pub fn global_registry() -> Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::new).clone()
}

/// Register a production evidence provider in the process-wide registry.
pub fn register_pointer_evidence_provider(
    provider: Arc<dyn PointerProvider>,
) -> Result<Registration, String> {
    global_registry().register_pointer(provider)
}

/// Register application production input recipes in the process-wide registry.
pub fn register_action_strategy_provider(
    provider: Arc<dyn ActionStrategyProvider>,
) -> Result<Registration, String> {
    global_registry().register_action_strategies(provider)
}

/// Register application production focus-manager evidence globally.
pub fn register_focus_evidence_provider(
    provider: Arc<dyn FocusProvider>,
) -> Result<Registration, String> {
    global_registry().register_focus(provider)
}

/// Register application production viewport evidence globally.
pub fn register_scroll_evidence_provider(
    provider: Arc<dyn ScrollProvider>,
) -> Result<Registration, String> {
    global_registry().register_scroll(provider)
}

/// Register application production painter attribution globally.
pub fn register_paint_evidence_provider(
    provider: Arc<dyn PaintProvider>,
) -> Result<Registration, String> {
    global_registry().register_paint(provider)
}

/// Register production terminal parser mode evidence globally.
pub fn register_terminal_input_mode_evidence_provider(
    provider: Arc<dyn InputModeProvider>,
) -> Result<Registration, String> {
    global_registry().register_input_modes(provider)
}

#[derive(Debug)]
pub(crate) struct Lease {
    state: Arc<Mutex<State>>,
    entries: Vec<Arc<Entry>>,
    closed: bool,
}
impl Lease {
    pub(crate) fn registrations(&self) -> Vec<EvidenceProviderRegistration> {
        self.entries
            .iter()
            .map(|e| EvidenceProviderRegistration {
                id: e.provider.id().into(),
                version: e.provider.version().into(),
                method: method_name(e.provider.method()).into(),
                capabilities: e.capabilities.clone(),
            })
            .collect()
    }
    pub(crate) fn collect(
        &self,
        session_id: &str,
        revision: i64,
        columns: i64,
        rows: i64,
    ) -> Vec<ProviderRevisionEvidence> {
        self.entries
            .iter()
            .map(|e| collect_entry(e, session_id, revision, columns, rows))
            .collect()
    }
    pub(crate) fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.state
            .lock()
            .expect("evidence registry poisoned")
            .active_leases -= 1;
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.close()
    }
}
fn method_name(method: EvidenceMethod) -> &'static str {
    match method {
        EvidenceMethod::Native => "native",
        EvidenceMethod::Declared => "declared",
        _ => "instrumented",
    }
}

fn collect_entry(
    entry: &Entry,
    session_id: &str,
    revision: i64,
    columns: i64,
    rows: i64,
) -> ProviderRevisionEvidence {
    let base = |status: &str, reason: Option<String>| ProviderRevisionEvidence {
        provider_id: entry.provider.id().into(),
        session_id: session_id.into(),
        revision,
        status: status.into(),
        evidence: None,
        pointer_regions: None,
        focus_state: None,
        action_recipes: None,
        scroll_states: None,
        painted_regions: None,
        input_modes: None,
        hit_grid: None,
        reason,
    };
    if !entry.active.load(Ordering::SeqCst) {
        return base("lost", Some("provider disposed after negotiation".into()));
    }
    let observation = match entry.provider.observe(&Context {
        session_id: session_id.into(),
        revision,
        columns,
        rows,
    }) {
        Ok(v) => v,
        Err(e) => return base("violation", Some(e)),
    };
    let mut result = base("available", None);
    result.evidence = Some(EvidenceProvenance {
        source: EvidenceSource::Application,
        method: entry.provider.method(),
        strength: EvidenceStrength::Authoritative,
        provider_id: entry.provider.id().into(),
    });
    let capabilities = &entry.capabilities;
    if !capabilities.iter().any(|v| v == "pointer-regions")
        && !observation.pointer_regions.is_empty()
    {
        return base(
            "violation",
            Some("published pointer regions without negotiating pointer-regions".into()),
        );
    }
    if !capabilities.iter().any(|v| v == "hit-test") && observation.hit_test.is_some() {
        return base(
            "violation",
            Some("published a hit-test callback without negotiating hit-test".into()),
        );
    }
    if capabilities.iter().any(|v| v == "action-recipes") && observation.action_recipes.is_none() {
        return base(
            "violation",
            Some("negotiated action-recipes evidence is unavailable".into()),
        );
    }
    if !capabilities.iter().any(|v| v == "action-recipes") && observation.action_recipes.is_some() {
        return base(
            "violation",
            Some("published action recipes without negotiating action-recipes".into()),
        );
    }
    if capabilities.iter().any(|v| v == "focus-state") && observation.focus_state.is_none() {
        return base(
            "violation",
            Some("negotiated focus-state evidence is unavailable".into()),
        );
    }
    if !capabilities.iter().any(|v| v == "focus-state") && observation.focus_state.is_some() {
        return base(
            "violation",
            Some("published focus state without negotiating focus-state".into()),
        );
    }
    if capabilities.iter().any(|v| v == "scroll-state") && observation.scroll_states.is_none() {
        return base(
            "violation",
            Some("negotiated scroll-state evidence is unavailable".into()),
        );
    }
    if !capabilities.iter().any(|v| v == "scroll-state") && observation.scroll_states.is_some() {
        return base(
            "violation",
            Some("published scroll state without negotiating scroll-state".into()),
        );
    }
    if let Some(states) = &observation.scroll_states {
        if states.iter().any(|state| {
            state.offset < 0
                || state.viewport < 0
                || state.extent < 0
                || state.offset + state.viewport > state.extent
        }) {
            return base(
                "violation",
                Some("scroll state must fit inside its extent".into()),
            );
        }
    }
    if capabilities.iter().any(|v| v == "painted-regions") && observation.painted_regions.is_none()
    {
        return base(
            "violation",
            Some("negotiated painted-regions evidence is unavailable".into()),
        );
    }
    if !capabilities.iter().any(|v| v == "painted-regions") && observation.painted_regions.is_some()
    {
        return base(
            "violation",
            Some("published painted regions without negotiating painted-regions".into()),
        );
    }
    if capabilities.iter().any(|v| v == "terminal-input-modes") && observation.input_modes.is_none()
    {
        return base(
            "violation",
            Some("negotiated terminal-input-modes evidence is unavailable".into()),
        );
    }
    if !capabilities.iter().any(|v| v == "terminal-input-modes")
        && observation.input_modes.is_some()
    {
        return base(
            "violation",
            Some("published input modes without negotiating terminal-input-modes".into()),
        );
    }
    if let Some(modes) = &observation.input_modes {
        if !matches!(
            modes.mouse_tracking.as_str(),
            "none" | "x10" | "vt200" | "drag" | "any"
        ) || !matches!(
            modes.mouse_encoding.as_str(),
            "default" | "sgr" | "urxvt" | "utf8"
        ) || !matches!(modes.focus_reporting.as_str(), "on" | "off")
        {
            return base(
                "violation",
                Some("terminal input modes contain an invalid value".into()),
            );
        }
    }
    result.pointer_regions = Some(observation.pointer_regions);
    result.action_recipes = observation.action_recipes;
    result.focus_state = observation.focus_state;
    result.scroll_states = observation.scroll_states;
    result.painted_regions = observation.painted_regions;
    result.input_modes = observation.input_modes;
    if capabilities.iter().any(|v| v == "hit-test") {
        match exact_grid(
            result.pointer_regions.as_deref().unwrap_or_default(),
            observation.hit_test,
            columns,
            rows,
            capabilities.iter().any(|v| v == "pointer-regions"),
        ) {
            Ok(grid) => result.hit_grid = Some(grid),
            Err(error) => return base("violation", Some(error)),
        }
    }
    result
}

fn exact_grid(
    regions: &[ProviderPointerRegion],
    hit_test: Option<HitTest>,
    columns: i64,
    rows: i64,
    verify_declared_regions: bool,
) -> Result<PointerHitGrid, String> {
    let hit_test = hit_test.ok_or_else(|| "negotiated hit-test callback unavailable".to_owned())?;
    if columns.checked_mul(rows).unwrap_or(i64::MAX) > 1_000_000 {
        return Err("hit-test viewport exceeds provider limit".into());
    }
    let mut declared = HashMap::new();
    for region in regions {
        for span in &region.spans {
            for column in span.from..span.to {
                let key = (span.row, column);
                if let Some(old) = declared.insert(key, region.recipient_id.clone()) {
                    if old != region.recipient_id {
                        return Err("overlapping pointer regions".into());
                    }
                }
            }
        }
    }
    let mut output = Vec::new();
    for row in 0..rows {
        let mut start: Option<i64> = None;
        let mut owner: Option<String> = None;
        for column in 0..=columns {
            let actual = if column == columns {
                None
            } else {
                hit_test(column, row)
            };
            let expected = if column == columns {
                None
            } else {
                declared.get(&(row, column)).cloned()
            };
            if verify_declared_regions && actual != expected {
                return Err(format!("production hit test disagrees at {column},{row}"));
            }
            if actual != owner {
                if let (Some(from), Some(id)) = (start.take(), owner.take()) {
                    output.push(PointerHitRegion {
                        recipient_id: id,
                        rect: Rect {
                            row,
                            column: from,
                            width: column - from,
                            height: 1,
                        },
                    })
                }
                if actual.is_some() {
                    start = Some(column);
                    owner = actual
                }
            }
        }
    }
    Ok(PointerHitGrid { regions: output })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::{ProviderPointerSpan, Rect};

    #[derive(Debug)]
    struct Router;
    impl PointerProvider for Router {
        fn id(&self) -> &str {
            "router"
        }
        fn version(&self) -> &str {
            "1"
        }
        fn method(&self) -> EvidenceMethod {
            EvidenceMethod::Native
        }
        fn capabilities(&self) -> Vec<String> {
            vec!["pointer-regions".into(), "hit-test".into()]
        }
        fn observe(&self, _context: &Context) -> Result<PointerObservation, String> {
            Ok(PointerObservation {
                pointer_regions: vec![ProviderPointerRegion {
                    recipient_id: "reject".into(),
                    region_bounds: Rect {
                        row: 1,
                        column: 2,
                        width: 3,
                        height: 1,
                    },
                    spans: vec![ProviderPointerSpan {
                        row: 1,
                        from: 2,
                        to: 5,
                    }],
                }],
                hit_test: Some(Arc::new(|column, row| {
                    (row == 1 && (2..5).contains(&column)).then(|| "reject".into())
                })),
            })
        }
    }

    #[derive(Debug)]
    struct Regions;
    impl PointerProvider for Regions {
        fn id(&self) -> &str {
            "regions"
        }
        fn version(&self) -> &str {
            "1"
        }
        fn method(&self) -> EvidenceMethod {
            EvidenceMethod::Declared
        }
        fn capabilities(&self) -> Vec<String> {
            vec!["pointer-regions".into()]
        }
        fn observe(&self, _context: &Context) -> Result<PointerObservation, String> {
            Ok(PointerObservation {
                pointer_regions: Router.observe(_context)?.pointer_regions,
                hit_test: None,
            })
        }
    }

    #[derive(Debug)]
    struct HitTestOnly;
    impl PointerProvider for HitTestOnly {
        fn id(&self) -> &str {
            "production-router"
        }
        fn version(&self) -> &str {
            "2"
        }
        fn method(&self) -> EvidenceMethod {
            EvidenceMethod::Native
        }
        fn capabilities(&self) -> Vec<String> {
            vec!["hit-test".into()]
        }
        fn observe(&self, _context: &Context) -> Result<PointerObservation, String> {
            Ok(PointerObservation {
                pointer_regions: Vec::new(),
                hit_test: Some(Arc::new(|column, row| {
                    (row == 1 && (2..5).contains(&column)).then(|| "reject".into())
                })),
            })
        }
    }

    #[test]
    fn freezes_per_session_and_fails_closed_after_loss() {
        let registry = Registry::new();
        let registration = registry
            .register_pointer(Arc::new(Router))
            .expect("register");
        let lease = registry.freeze();
        assert!(registry.register_pointer(Arc::new(Router)).is_err());
        let evidence = lease.collect("s1", 1, 10, 4);
        assert_eq!(evidence[0].status, "available");
        assert_eq!(evidence[0].hit_grid.as_ref().unwrap().regions.len(), 1);
        registration.dispose();
        assert_eq!(lease.collect("s1", 2, 10, 4)[0].status, "lost");
    }

    #[test]
    fn composes_independent_region_and_hit_test_providers() {
        let registry = Registry::new();
        registry
            .register_pointer(Arc::new(Regions))
            .expect("regions");
        registry
            .register_pointer(Arc::new(HitTestOnly))
            .expect("hit test");
        let evidence = registry.freeze().collect("s1", 4, 10, 4);
        let regions = evidence
            .iter()
            .find(|entry| entry.provider_id == "regions")
            .unwrap();
        let hits = evidence
            .iter()
            .find(|entry| entry.provider_id == "production-router")
            .unwrap();
        assert_eq!(regions.status, "available");
        assert_eq!(regions.pointer_regions.as_ref().unwrap().len(), 1);
        assert!(regions.hit_grid.is_none());
        assert_eq!(hits.status, "available");
        assert!(hits.pointer_regions.as_ref().unwrap().is_empty());
        assert_eq!(hits.hit_grid.as_ref().unwrap().regions.len(), 1);
    }

    #[derive(Debug)]
    struct Keys;
    impl ActionStrategyProvider for Keys {
        fn id(&self) -> &str {
            "app.keys"
        }
        fn version(&self) -> &str {
            "1"
        }
        fn method(&self) -> EvidenceMethod {
            EvidenceMethod::Native
        }
        fn observe(&self, _context: &Context) -> Result<Vec<ProviderActionRecipes>, String> {
            Ok(vec![ProviderActionRecipes {
                recipient_id: "editor".into(),
                recipes: vec![crate::tree::PhysicalInputRecipe {
                    action: crate::tree::PhysicalInputRecipeAction::SetValue,
                    requires_focus: true,
                    steps: vec![
                        crate::tree::PhysicalInputRecipeStep::Press {
                            key: "Control+U".into(),
                        },
                        crate::tree::PhysicalInputRecipeStep::InsertActionValue,
                    ],
                }],
            }])
        }
    }

    #[derive(Debug)]
    struct Focus;
    impl FocusProvider for Focus {
        fn id(&self) -> &str {
            "app.focus"
        }
        fn version(&self) -> &str {
            "1"
        }
        fn method(&self) -> EvidenceMethod {
            EvidenceMethod::Native
        }
        fn observe(&self, context: &Context) -> Result<Option<String>, String> {
            Ok((context.revision == 1).then(|| "editor".into()))
        }
    }

    #[derive(Debug)]
    struct Scroll;
    impl ScrollProvider for Scroll {
        fn id(&self) -> &str {
            "app.scroll"
        }
        fn version(&self) -> &str {
            "1"
        }
        fn method(&self) -> EvidenceMethod {
            EvidenceMethod::Native
        }
        fn observe(&self, _context: &Context) -> Result<Vec<ProviderScrollState>, String> {
            Ok(vec![ProviderScrollState {
                recipient_id: "results".into(),
                axis: crate::tree::Orientation::Vertical,
                offset: 3,
                viewport: 4,
                extent: 20,
            }])
        }
    }

    #[test]
    fn focus_provider_preserves_authoritative_none() {
        let registry = Registry::new();
        registry.register_focus(Arc::new(Focus)).expect("focus");
        let lease = registry.freeze();
        assert_eq!(lease.registrations()[0].capabilities, vec!["focus-state"]);
        assert!(matches!(
            lease.collect("s", 1, 80, 24)[0].focus_state,
            Some(ProviderFocusState::Focused { ref recipient_id }) if recipient_id == "editor"
        ));
        assert!(matches!(
            lease.collect("s", 2, 80, 24)[0].focus_state,
            Some(ProviderFocusState::None)
        ));
    }

    #[test]
    fn scroll_provider_publishes_bounded_application_viewport_state() {
        let registry = Registry::new();
        registry.register_scroll(Arc::new(Scroll)).expect("scroll");
        let lease = registry.freeze();
        assert_eq!(lease.registrations()[0].capabilities, vec!["scroll-state"]);
        let frame = lease.collect("s", 1, 80, 24).remove(0);
        assert_eq!(frame.status, "available");
        assert_eq!(frame.scroll_states.as_ref().unwrap()[0].offset, 3);
    }

    #[test]
    fn action_strategy_provider_is_a_separate_closed_family() {
        let registry = Registry::new();
        registry
            .register_action_strategies(Arc::new(Keys))
            .expect("keys");
        let frame = registry.freeze().collect("s", 3, 80, 24).remove(0);
        assert_eq!(frame.status, "available");
        assert_eq!(frame.action_recipes.as_ref().map(Vec::len), Some(1));
        assert!(frame.pointer_regions.as_ref().is_some_and(Vec::is_empty));
        assert!(frame.hit_grid.is_none());
    }

    #[test]
    fn rejects_invalid_and_competing_capability_declarations() {
        #[derive(Debug)]
        struct Invalid;
        impl PointerProvider for Invalid {
            fn id(&self) -> &str {
                "invalid"
            }
            fn version(&self) -> &str {
                "1"
            }
            fn method(&self) -> EvidenceMethod {
                EvidenceMethod::Declared
            }
            fn capabilities(&self) -> Vec<String> {
                vec!["unknown".into()]
            }
            fn observe(&self, _: &Context) -> Result<PointerObservation, String> {
                unreachable!()
            }
        }
        let registry = Registry::new();
        assert!(registry.register_pointer(Arc::new(Invalid)).is_err());
        registry
            .register_pointer(Arc::new(Regions))
            .expect("regions");
        assert!(registry.register_pointer(Arc::new(Regions)).is_err());
        registry
            .register_pointer(Arc::new(HitTestOnly))
            .expect("hit test");
    }
}
