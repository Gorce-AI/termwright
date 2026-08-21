//! Session-scoped application evidence providers.

use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};

use crate::messages::EvidenceProviderRegistration;
use crate::tree::{
    EvidenceMethod, EvidenceProvenance, EvidenceSource, EvidenceStrength, PointerHitGrid,
    PointerHitRegion, ProviderPointerRegion, ProviderRevisionEvidence, Rect,
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

/// Exact production-router facts returned for one revision.
pub struct ProviderObservation {
    /// Canonical pointer-owned regions for semantic recipients.
    pub pointer_regions: Vec<ProviderPointerRegion>,
    /// Optional production hit-test used to verify the complete viewport.
    pub hit_test: Option<HitTest>,
}

/// Thread-safe production pointer hit-test in `(column, row)` order.
pub type HitTest = Arc<dyn Fn(i64, i64) -> Option<String> + Send + Sync>;

/// Application integration that exposes authoritative production evidence.
pub trait Provider: Debug + Send + Sync {
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
    fn observe(&self, context: &Context) -> Result<ProviderObservation, String>;
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
    pub fn register(&self, provider: Arc<dyn Provider>) -> Result<Registration, String> {
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
        for capability in &capabilities {
            if state
                .entries
                .values()
                .any(|entry| entry.capabilities.iter().any(|value| value == capability))
            {
                return Err(format!("competing {capability} providers"));
            }
        }
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
        if capability != "pointer-regions" && capability != "hit-test" {
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
    provider: Arc<dyn Provider>,
) -> Result<Registration, String> {
    global_registry().register(provider)
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
    result.pointer_regions = Some(observation.pointer_regions);
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
    impl Provider for Router {
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
        fn observe(&self, _context: &Context) -> Result<ProviderObservation, String> {
            Ok(ProviderObservation {
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
    impl Provider for Regions {
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
        fn observe(&self, _context: &Context) -> Result<ProviderObservation, String> {
            Ok(ProviderObservation {
                pointer_regions: Router.observe(_context)?.pointer_regions,
                hit_test: None,
            })
        }
    }

    #[derive(Debug)]
    struct HitTestOnly;
    impl Provider for HitTestOnly {
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
        fn observe(&self, _context: &Context) -> Result<ProviderObservation, String> {
            Ok(ProviderObservation {
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
        let registration = registry.register(Arc::new(Router)).expect("register");
        let lease = registry.freeze();
        assert!(registry.register(Arc::new(Router)).is_err());
        let evidence = lease.collect("s1", 1, 10, 4);
        assert_eq!(evidence[0].status, "available");
        assert_eq!(evidence[0].hit_grid.as_ref().unwrap().regions.len(), 1);
        registration.dispose();
        assert_eq!(lease.collect("s1", 2, 10, 4)[0].status, "lost");
    }

    #[test]
    fn composes_independent_region_and_hit_test_providers() {
        let registry = Registry::new();
        registry.register(Arc::new(Regions)).expect("regions");
        registry.register(Arc::new(HitTestOnly)).expect("hit test");
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

    #[test]
    fn rejects_invalid_and_competing_capability_declarations() {
        #[derive(Debug)]
        struct Invalid;
        impl Provider for Invalid {
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
            fn observe(&self, _: &Context) -> Result<ProviderObservation, String> {
                unreachable!()
            }
        }
        let registry = Registry::new();
        assert!(registry.register(Arc::new(Invalid)).is_err());
        registry.register(Arc::new(Regions)).expect("regions");
        assert!(registry.register(Arc::new(Regions)).is_err());
        registry.register(Arc::new(HitTestOnly)).expect("hit test");
    }
}
