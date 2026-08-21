//! Semantic tree DTOs.
//!
//! Unset optionals are omitted from the wire form: the schema is strict, so an
//! explicit `null` is a validation failure rather than "absent".

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::roles::{Action, Role};

/// Zero-based viewport cell rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    /// Zero-based row of the top edge.
    pub row: i64,
    /// Zero-based column of the left edge.
    pub column: i64,
    /// Width in cells; zero means nothing is painted.
    pub width: i64,
    /// Height in cells; zero means nothing is painted.
    pub height: i64,
}

impl Rect {
    /// Build a rectangle from absolute viewport coordinates.
    pub fn new(row: i64, column: i64, width: i64, height: i64) -> Self {
        Self {
            row,
            column,
            width,
            height,
        }
    }
}

/// Evidence-qualified fact. Unknown and unsupported are never coerced to false.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Observation<T> {
    /// The producer knows the value and names the evidence behind it.
    Known {
        /// Observed value.
        value: T,
        /// Provenance of the observation.
        evidence: EvidenceProvenance,
    },
    /// The fact has no value for the named lifecycle/layout reason.
    Absent {
        /// Why no value exists.
        reason: String,
        /// Authoritative provenance proving that no value exists.
        evidence: EvidenceProvenance,
    },
    /// The fact may become observable on a later revision.
    Unknown {
        /// Why evidence is not currently available.
        reason: String,
    },
    /// The negotiated producer cannot provide this capability.
    Unsupported {
        /// Missing wire or framework capability.
        capability: String,
        /// Why the capability is unavailable.
        reason: String,
    },
}

/// Provenance carried by every known physical observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceProvenance {
    /// Layer that supplied the fact.
    pub source: EvidenceSource,
    /// How that layer obtained the fact.
    pub method: EvidenceMethod,
    /// Whether the fact is safe for behavior or diagnostic only.
    pub strength: EvidenceStrength,
    /// Stable identity of the provider that made the observation.
    pub provider_id: String,
}

/// Layer that supplied a known observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EvidenceSource {
    /// The UI framework itself.
    Framework,
    /// Application-authored information.
    Application,
    /// The terminal emulator or terminal grid.
    Terminal,
    /// A recognizer derived the fact from another representation.
    Recognizer,
    /// The Termwright driver measured the fact.
    Driver,
}

/// Method used to produce a known observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceMethod {
    /// Native framework/runtime observation.
    Native,
    /// Observation made by installed instrumentation.
    Instrumented,
    /// Explicit application declaration.
    Declared,
    /// Correlation across independently identified facts.
    Correlated,
    /// Direct measurement.
    Measured,
    /// Deterministic derivation from stronger facts.
    Derived,
    /// Best-effort heuristic; never behavioral authority.
    Heuristic,
}

/// Authority of a known observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EvidenceStrength {
    /// May be used to decide behavior.
    Authoritative,
    /// May be shown for diagnosis but not used as behavioral proof.
    Diagnostic,
}

/// Display and layout facts for one protocol-v2 semantic node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeGeometryObservations {
    /// Effective display state through the complete ancestor chain.
    pub displayed: Observation<bool>,
    /// Layout rectangle before viewport clipping.
    pub intended_rect: Observation<Rect>,
    /// Rectangle remaining after framework clipping.
    pub visible_rect: Observation<Rect>,
}

/// One non-overlapping rectangle owned by an exact pointer recipient.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PointerHitRegion {
    /// Half-open viewport-cell rectangle.
    pub rect: Rect,
    /// Semantic node id receiving a fresh pointer event in this rectangle.
    pub recipient_id: String,
}

/// Compressed exact fresh-pointer routing grid for a completed frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PointerHitGrid {
    /// Non-overlapping recipient rectangles.
    pub regions: Vec<PointerHitRegion>,
}

/// One canonical half-open pointer row run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderPointerSpan {
    /// Viewport row containing the run.
    pub row: i64,
    /// Inclusive starting column.
    pub from: i64,
    /// Exclusive ending column.
    pub to: i64,
}

/// Pointer-only application region; never layout or clipping geometry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderPointerRegion {
    /// Semantic node that the production router associates with the region.
    pub recipient_id: String,
    /// Bounding rectangle used only as pointer-region metadata.
    pub region_bounds: Rect,
    /// Exact possibly disjoint owned cells as canonical row spans.
    pub spans: Vec<ProviderPointerSpan>,
}

/// Revision-bound application evidence. `status` is available, lost, or violation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderRevisionEvidence {
    /// Stable negotiated provider identity.
    pub provider_id: String,
    /// Session this evidence belongs to.
    pub session_id: String,
    /// Semantic revision described by the evidence.
    pub revision: i64,
    /// `available`, `lost`, or `violation`.
    pub status: String,
    /// Provenance present for available evidence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<EvidenceProvenance>,
    /// Exact pointer regions when the provider supplies them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointer_regions: Option<Vec<ProviderPointerRegion>>,
    /// Complete verified production hit grid when negotiated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hit_grid: Option<PointerHitGrid>,
    /// Diagnostic explanation for lost or violating providers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Whether a tri-state control is on, off, or partially selected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Checked {
    /// Plain on/off.
    Flag(bool),
    /// The literal string `"mixed"`.
    Mixed(MixedState),
}

/// The `"mixed"` literal, as its own type so serde can keep the schema closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MixedState {
    /// The literal `"mixed"`.
    #[serde(rename = "mixed")]
    Mixed,
}

/// Layout direction of a composite widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    /// Laid out left to right.
    Horizontal,
    /// Laid out top to bottom.
    Vertical,
}

/// Cursor rendering style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CursorShape {
    /// A filled block cursor.
    Block,
    /// An underline cursor.
    Underline,
    /// A vertical bar cursor.
    Bar,
}

/// The closed state set. `None` means "not asserted", not "false".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    /// The control refuses interaction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// Keyboard input goes here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused: Option<bool>,
    /// The node is selected within its parent set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    /// Checked, unchecked, or mixed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<Checked>,
    /// A disclosure is open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    /// The node traps interaction while it is present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modal: Option<bool>,
    /// Content is being loaded or recomputed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub busy: Option<bool>,
    /// Present in the tree but not painted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Every cell is outside the visible area — scrolled away, not
    /// undisplayed. Implies [`State::hidden`]; the pair without it is refused
    /// by validation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offscreen: Option<bool>,
    /// Value is displayed but cannot be edited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
    /// The text control accepts newlines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiline: Option<bool>,
    /// Layout direction of a composite widget.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<Orientation>,
    /// Heading or tree depth, starting at 1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i64>,
    /// One-based position among siblings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_in_set: Option<i64>,
    /// Number of siblings in the set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_size: Option<i64>,
    /// First visible unit of scrollable content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_offset: Option<i64>,
    /// Total scrollable units.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_extent: Option<i64>,
}

impl State {
    /// Whether every member is unset, in which case the field is omitted.
    pub fn is_empty(&self) -> bool {
        *self == State::default()
    }
}

/// Maps grapheme offsets of a node's text onto cell coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextRange {
    /// First grapheme offset covered by `rect`.
    pub start_offset: i64,
    /// Offset just past the last grapheme covered by `rect`.
    pub end_offset: i64,
    /// Cells the offset span occupies.
    pub rect: Rect,
}

/// One accessible node with evidence-qualified geometry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    /// Stable identity within the session.
    pub id: String,
    /// Parent node, or `None` for a root.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Semantic role from the current closed set.
    pub role: Role,
    /// Accessible name; empty when the node has none.
    pub name: String,
    /// Longer description, when one exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Current value of a value-bearing node.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Asserted state flags; unset members are not claims.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<State>,
    /// Application-defined JSON state, separate from portable state flags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extended: Option<BTreeMap<String, Value>>,
    /// Capability hints, never callback endpoints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<Action>>,
    /// Ids of nodes that name this one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labelled_by: Option<Vec<String>>,
    /// Ids of nodes that describe this one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub described_by: Option<Vec<String>>,
    /// Offset-to-cell mapping for this node's text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_ranges: Option<Vec<TextRange>>,
    /// Author-supplied test id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_id: Option<String>,
    /// What the UI framework calls this widget. Required when `role` is
    /// [`Role::Generic`]: an unrecognised widget must at least name its own
    /// type, so a reader can tell one unknown thing from another.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework_type: Option<String>,
    /// Where this node's facts came from, as a whole.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p: Option<Provenance>,
    /// Where individual fields came from, when they differ from `p`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub px: Option<BTreeMap<String, Provenance>>,
    /// Qualified layout facts for this committed observation.
    pub geometry: NodeGeometryObservations,
}

/// Where a semantic fact came from. Closed set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provenance {
    /// What the author wrote.
    Annotation,
    /// What our rules concluded.
    Recognizer,
    /// What the framework itself reported.
    Framework,
    /// What matching across sources implied.
    Correlation,
    /// A guess that happened to be useful.
    Heuristic,
}

impl Node {
    /// A node with only the required fields set.
    pub fn new(id: impl Into<String>, role: Role, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            parent_id: None,
            role,
            name: name.into(),
            description: None,
            value: None,
            state: None,
            extended: None,
            actions: None,
            labelled_by: None,
            described_by: None,
            text_ranges: None,
            test_id: None,
            framework_type: None,
            p: None,
            px: None,
            geometry: NodeGeometryObservations {
                displayed: Observation::Unsupported {
                    capability: "displayed".into(),
                    reason: "framework-unobservable".into(),
                },
                intended_rect: Observation::Unsupported {
                    capability: "intended-geometry".into(),
                    reason: "framework-unobservable".into(),
                },
                visible_rect: Observation::Unsupported {
                    capability: "clipped-geometry".into(),
                    reason: "framework-unobservable".into(),
                },
            },
        }
    }

    /// Name what the framework calls this widget, which the protocol requires
    /// for a [`Role::Generic`] node.
    pub fn with_framework_type(mut self, framework_type: impl Into<String>) -> Self {
        self.framework_type = Some(framework_type.into());
        self
    }

    /// Attach this node to a parent.
    pub fn with_parent(mut self, parent_id: impl Into<String>) -> Self {
        self.parent_id = Some(parent_id.into());
        self
    }

    /// Set evidence-qualified layout facts.
    pub fn with_geometry(mut self, geometry: NodeGeometryObservations) -> Self {
        self.geometry = geometry;
        self
    }

    /// Set the state flags, dropping them when nothing is asserted.
    pub fn with_state(mut self, state: State) -> Self {
        self.state = if state.is_empty() { None } else { Some(state) };
        self
    }

    /// Attach application-defined JSON state.
    pub fn with_extended(mut self, extended: BTreeMap<String, Value>) -> Self {
        self.extended = Some(extended);
        self
    }

    /// Declare which actions the node supports.
    pub fn with_actions(mut self, actions: Vec<Action>) -> Self {
        self.actions = Some(actions);
        self
    }

    /// Set the author-supplied test id.
    pub fn with_test_id(mut self, test_id: impl Into<String>) -> Self {
        self.test_id = Some(test_id.into());
        self
    }
}

/// Terminal cursor position, in viewport cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cursor {
    /// Zero-based row of the top edge.
    pub row: i64,
    /// Zero-based column of the left edge.
    pub column: i64,
    /// Whether the terminal is showing the cursor.
    pub visible: bool,
    /// Cursor rendering style, when the app sets one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<CursorShape>,
}

/// The whole tree for one committed render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    /// Snapshot format version; always 2.
    pub v: u8,
    /// Session this snapshot belongs to.
    pub session_id: String,
    /// Render revision, strictly increasing per session.
    pub revision: i64,
    /// Viewport width in cells.
    pub columns: i64,
    /// Viewport height in cells.
    pub rows: i64,
    /// Cursor position, when the app reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<Cursor>,
    /// Ids of the parentless nodes, in document order.
    pub root_ids: Vec<String>,
    /// Every node in the tree.
    pub nodes: Vec<Node>,
    /// Qualified coordinate space for all known geometry.
    pub coordinate_space: Observation<String>,
    /// Exact fresh-pointer ownership map, or an explicit non-known result.
    pub hit_grid: Observation<PointerHitGrid>,
    /// Application evidence collected atomically for this semantic revision.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provider_evidence: Vec<ProviderRevisionEvidence>,
}

impl Snapshot {
    /// An empty snapshot for a viewport. The session id and revision are
    /// filled in by [`crate::Client::publish`].
    pub fn new(columns: i64, rows: i64) -> Self {
        Self {
            v: 2,
            session_id: String::new(),
            revision: 0,
            columns,
            rows,
            cursor: None,
            root_ids: Vec::new(),
            nodes: Vec::new(),
            coordinate_space: Observation::Known {
                value: "viewport-cells".into(),
                evidence: EvidenceProvenance {
                    source: EvidenceSource::Framework,
                    method: EvidenceMethod::Instrumented,
                    strength: EvidenceStrength::Authoritative,
                    provider_id: "termwright-rust-client".into(),
                },
            },
            hit_grid: Observation::Unsupported {
                capability: "pointer-hit-grid".into(),
                reason: "framework-unobservable".into(),
            },
            provider_evidence: Vec::new(),
        }
    }

    /// Append a node, recording it as a root when it declares no parent.
    pub fn push(&mut self, node: Node) {
        if node.parent_id.is_none() {
            self.root_ids.push(node.id.clone());
        }
        self.nodes.push(node);
    }
}
