//! Turning one frame's intercepted calls into a semantic tree.
//!
//! Everything about this is shaped by immediate mode, and the shape is
//! unflattering on purpose. What Ratatui hands us per frame is an ordered list
//! of "this type was drawn into this rectangle" — no parents, no identity, no
//! record of who ended up owning which cell. A recogniser that produced a
//! tidy-looking hierarchy from that would be inventing three facts to hide one.
//!
//! So the tree is flat, its ids last exactly one frame, and every node admits
//! it cannot say whether something was painted over it:
//!
//! - **Flat.** `Frame::render_widget` is a pass-through with no nesting to
//!   observe; a widget that draws its children does so inside its own
//!   `render`, which we never see. A flat list of roots is the honest
//!   degenerate tree, and the IR says as much.
//! - **Frame-local ids by default.** `Widget::render` takes `self` by value, so
//!   the widget is gone by the time the call returns and nothing survives to
//!   be named again next frame. Ids carry the frame number unless the author
//!   explicitly supplies a unique semantic key. Duplicate explicit keys are a
//!   fatal producer-contract violation; they never degrade to frame-local ids.
//! - **No pointer ownership claim.** Ratatui exposes no paint order, so the
//!   snapshot-level hit grid is explicitly unsupported.
//!
//! Geometry distinguishes the widget's intended rectangle from its viewport
//! clipping. Neither fact is treated as pointer ownership.

use std::collections::BTreeMap;

use termwright_protocol::tree::{
    EvidenceMethod, EvidenceProvenance, EvidenceSource, EvidenceStrength, Node,
    NodeGeometryObservations, Observation, Provenance, Rect, Snapshot, State,
};
use termwright_protocol::{Role, DEFAULT_LIMITS};

use crate::{Annotation, RenderCall};

/// Ratatui widget type paths mapped onto semantic roles.
///
/// Keyed on the type path's last segment, which is what `type_name` gives
/// after the generics are stripped. Anything absent stays `generic` and keeps
/// its own type name, which is how an application's own widget survives as a
/// node a test can still find.
fn role_for(type_path: &str) -> Option<Role> {
    Some(match last_segment(type_path) {
        "Paragraph" | "Text" | "Span" | "Line" => Role::Text,
        "List" => Role::List,
        "ListItem" => Role::ListItem,
        "Table" => Role::Table,
        "Row" => Role::Row,
        "Tabs" => Role::List,
        "Gauge" | "LineGauge" | "Sparkline" => Role::ProgressBar,
        "Scrollbar" => Role::Scrollbar,
        "Block" => Role::Region,
        "Chart" | "BarChart" | "Canvas" => Role::Region,
        "Clear" => return None,
        _ => return None,
    })
}

/// The part of a type path a role map is keyed on.
fn last_segment(type_path: &str) -> &str {
    type_path.rsplit("::").next().unwrap_or(type_path)
}

/// `type_name` output without its generic arguments.
///
/// `ratatui_widgets::paragraph::Paragraph<'_>` becomes
/// `ratatui_widgets::paragraph::Paragraph`. The lifetime tells a reader
/// nothing and would differ between otherwise identical widgets.
#[must_use]
pub fn strip_generics(type_name: &str) -> &str {
    let unwrapped = type_name
        .strip_prefix("&mut ")
        .or_else(|| type_name.strip_prefix('&'))
        .unwrap_or(type_name)
        .trim_start();
    match unwrapped.find('<') {
        Some(index) => unwrapped[..index].trim_end(),
        None => unwrapped,
    }
}

/// Build the tree for one frame.
///
/// `frame` is the frame counter Ratatui already keeps. It goes into every id
/// because unannotated ids are worth nothing outside their frame, and saying
/// so in the id itself is cheaper than hoping a consumer read the handshake.
/// A unique author semantic key instead produces `k:<key>`.
#[must_use]
pub fn snapshot_from(calls: &[RenderCall], frame: u64, columns: u16, rows: u16) -> Snapshot {
    snapshot_from_with_relation_limit(
        calls,
        frame,
        columns,
        rows,
        DEFAULT_LIMITS.max_relation_targets,
    )
}

/// Build a tree while respecting the relation ceiling negotiated for this
/// session. Kept separate so unit callers get the protocol default and the
/// live session can tighten it after hello-ack.
#[must_use]
pub(crate) fn snapshot_from_with_relation_limit(
    calls: &[RenderCall],
    frame: u64,
    columns: u16,
    rows: u16,
    max_relation_targets: usize,
) -> Snapshot {
    let mut snapshot = Snapshot::new(i64::from(columns), i64::from(rows));
    let mut key_counts = BTreeMap::<&str, usize>::new();
    for key in calls.iter().filter_map(annotation_key) {
        *key_counts.entry(key).or_default() += 1;
    }
    if let Some(key) = key_counts
        .iter()
        .find_map(|(key, count)| (*count > 1).then_some(*key))
    {
        panic!("duplicate SemanticKey {key:?}");
    }
    let stable_ids: BTreeMap<&str, String> = key_counts
        .keys()
        .map(|key| (*key, format!("k:{key}")))
        .collect();

    for call in calls {
        let type_path = strip_generics(call.type_name);
        let role = role_for(type_path);
        let stable_id = annotation_key(call).and_then(|key| stable_ids.get(key));
        let mut node = Node::new(
            stable_id
                .cloned()
                .unwrap_or_else(|| format!("f{frame}:{}", call.ordinal)),
            role.unwrap_or(Role::Generic),
            "",
        );
        let intended = Rect {
            row: i64::from(call.y),
            column: i64::from(call.x),
            width: i64::from(call.width),
            height: i64::from(call.height),
        };
        node.geometry = render_call_geometry(intended, columns, rows);
        // The rectangle and the type came from the framework; the role is our
        // conclusion about the type, and a consumer resolving a disagreement
        // needs to know which is which.
        node.p = Some(Provenance::Framework);
        if role.is_some() {
            node.px = Some(
                [("role".to_owned(), Provenance::Recognizer)]
                    .into_iter()
                    .collect(),
            );
        } else {
            // An unrecognised widget keeps the framework's own name for it,
            // which is what a `generic` node needs to stay distinguishable.
            node.framework_type = Some(type_path.to_owned());
        }
        if let Some(annotation) = &call.annotation {
            apply_annotation(
                &mut node,
                annotation,
                &stable_ids,
                stable_id.is_some(),
                max_relation_targets,
            );
        }
        let node_id = node.id.clone();
        snapshot.push(node);

        // A collection's rows are the only children this framework lets the
        // probe see, and only because the patch runs inside the widget crate:
        // `List::items` is `pub(crate)`, so the item text and the item count
        // are unreachable from outside and reachable from within.
        if let Some(collection) = &call.collection {
            push_items(&mut snapshot, &node_id, collection, frame, call.ordinal);
        }
    }
    snapshot
}

pub(crate) fn duplicate_semantic_key(calls: &[RenderCall]) -> Option<&str> {
    let mut counts = BTreeMap::<&str, usize>::new();
    for key in calls.iter().filter_map(annotation_key) {
        let count = counts.entry(key).or_default();
        *count += 1;
        if *count > 1 {
            return Some(key);
        }
    }
    None
}

fn render_call_geometry(intended: Rect, columns: u16, rows: u16) -> NodeGeometryObservations {
    NodeGeometryObservations {
        // Reaching the patched render call proves participation, but Ratatui
        // does not preserve which buffer writes came from this widget. A
        // no-op render and a painted widget are indistinguishable here.
        displayed: Observation::Unsupported {
            capability: "displayed".into(),
            reason: "framework-unobservable".into(),
        },
        intended_rect: Observation::Known {
            value: intended,
            evidence: geometry_evidence(EvidenceMethod::Instrumented),
        },
        // Ratatui gives the widget an area but does not preserve per-cell
        // ownership. The one exact clip we do know is the terminal viewport.
        visible_rect: Observation::Known {
            value: viewport_intersection(intended, columns, rows),
            evidence: geometry_evidence(EvidenceMethod::Derived),
        },
    }
}

fn geometry_evidence(method: EvidenceMethod) -> EvidenceProvenance {
    EvidenceProvenance {
        source: EvidenceSource::Framework,
        method,
        strength: EvidenceStrength::Authoritative,
        provider_id: "termwright-ratatui-probe".into(),
    }
}

fn viewport_intersection(rect: Rect, columns: u16, rows: u16) -> Rect {
    let row = rect.row.max(0);
    let column = rect.column.max(0);
    let bottom = (rect.row + rect.height).min(i64::from(rows));
    let right = (rect.column + rect.width).min(i64::from(columns));
    Rect::new(row, column, (right - column).max(0), (bottom - row).max(0))
}

fn annotation_key(call: &RenderCall) -> Option<&str> {
    call.annotation
        .as_ref()
        .and_then(|annotation| annotation.semantic_key.as_deref())
        .filter(|key| !key.is_empty())
}

/// Overlay author intent without touching framework-owned physical facts.
fn apply_annotation(
    node: &mut Node,
    annotation: &Annotation,
    stable_ids: &BTreeMap<&str, String>,
    semantic_key_applied: bool,
    max_relation_targets: usize,
) {
    let px = node.px.get_or_insert_with(Default::default);
    if let Some(role) = annotation.role {
        node.role = role;
        px.insert("role".to_owned(), Provenance::Annotation);
    }
    if let Some(name) = &annotation.name {
        node.name.clone_from(name);
        px.insert("name".to_owned(), Provenance::Annotation);
    }
    if let Some(description) = &annotation.description {
        node.description = Some(description.clone());
        px.insert("description".to_owned(), Provenance::Annotation);
    }
    if let Some(test_id) = &annotation.test_id {
        node.test_id = Some(test_id.clone());
        px.insert("testId".to_owned(), Provenance::Annotation);
    }
    if !annotation.extended.is_empty() {
        node.extended = Some(annotation.extended.clone());
        px.insert("extended".to_owned(), Provenance::Annotation);
    }
    if !annotation.actions.is_empty() {
        node.actions = Some(annotation.actions.clone());
        px.insert("actions".to_owned(), Provenance::Annotation);
    }
    let labelled_by = resolve_relations(&annotation.labelled_by, stable_ids, max_relation_targets);
    if !labelled_by.is_empty() {
        node.labelled_by = Some(labelled_by);
        px.insert("labelledBy".to_owned(), Provenance::Annotation);
    }
    let described_by =
        resolve_relations(&annotation.described_by, stable_ids, max_relation_targets);
    if !described_by.is_empty() {
        node.described_by = Some(described_by);
        px.insert("describedBy".to_owned(), Provenance::Annotation);
    }
    if semantic_key_applied {
        px.insert("id".to_owned(), Provenance::Annotation);
    }
    if px.is_empty() {
        node.px = None;
    }
}

fn resolve_relations(
    keys: &[String],
    stable_ids: &BTreeMap<&str, String>,
    max_relation_targets: usize,
) -> Vec<String> {
    let mut resolved = Vec::new();
    for key in keys {
        if resolved.len() == max_relation_targets {
            break;
        }
        if let Some(id) = stable_ids.get(key.as_str()) {
            if !resolved.contains(id) {
                resolved.push(id.clone());
            }
        }
    }
    resolved
}

/// Publish one node per item the collection reported.
///
/// `setSize` is the widget's own count, not the number published: a list of a
/// thousand rows says a thousand even when only [`crate::MAX_ITEMS`] of them
/// are carried, because the count is a fact about the list and the cap is a
/// fact about us.
fn push_items(
    snapshot: &mut Snapshot,
    parent: &str,
    collection: &crate::Collection,
    frame: u64,
    ordinal: u32,
) {
    for (index, text) in collection.items.iter().enumerate() {
        let mut item = Node::new(
            format!("f{frame}:{ordinal}:{index}"),
            Role::ListItem,
            text.clone(),
        );
        item.parent_id = Some(parent.to_owned());
        // This is a logical child reported by the instrumented collection,
        // not an independently rendered widget. Ratatui authoritatively tells
        // us that no separate render rectangle exists for this node. Keep the
        // list widget's own geometry known and represent the child's geometry
        // as absent rather than violating the session-wide guarantee with a
        // permanent `unsupported` observation.
        let logical_item_evidence = geometry_evidence(EvidenceMethod::Instrumented);
        item.geometry = NodeGeometryObservations {
            displayed: Observation::Unsupported {
                capability: "displayed".into(),
                reason: "framework-unobservable".into(),
            },
            intended_rect: Observation::Absent {
                reason: "not-laid-out".into(),
                evidence: logical_item_evidence.clone(),
            },
            visible_rect: Observation::Absent {
                reason: "not-laid-out".into(),
                evidence: logical_item_evidence,
            },
        };
        item.p = Some(Provenance::Framework);
        item.state = Some(State {
            selected: Some(collection.selected == Some(index)),
            position_in_set: Some((index + 1) as i64),
            set_size: Some(collection.item_count as i64),
            ..State::default()
        });
        snapshot.push(item);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use termwright_protocol::{validate_snapshot, DEFAULT_LIMITS};

    fn call(ordinal: u32, type_name: &'static str) -> RenderCall {
        RenderCall {
            ordinal,
            type_name,
            x: 0,
            y: ordinal as u16,
            width: 20,
            height: 1,
            collection: None,
            annotation: None,
        }
    }

    fn validated(snapshot: &mut Snapshot) {
        snapshot.session_id = "s-test".into();
        snapshot.revision = 1;
        let wire = serde_json::to_value(&*snapshot).expect("serialises");
        let result = validate_snapshot(&wire, &DEFAULT_LIMITS);
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn a_frame_becomes_a_valid_flat_tree() {
        let calls = [
            call(0, "ratatui_widgets::block::Block<'_>"),
            call(1, "ratatui_widgets::paragraph::Paragraph<'_>"),
        ];
        let mut snapshot = snapshot_from(&calls, 1, 80, 24);
        validated(&mut snapshot);

        assert_eq!(snapshot.nodes.len(), 2);
        // Immediate mode gives no nesting to observe, so every node is a root.
        assert_eq!(snapshot.root_ids.len(), 2);
        assert!(snapshot.nodes.iter().all(|node| node.parent_id.is_none()));
    }

    #[test]
    fn roles_come_from_the_type_name() {
        let calls = [
            call(0, "ratatui_widgets::paragraph::Paragraph<'_>"),
            call(1, "ratatui_widgets::list::List<'_>"),
            call(2, "ratatui_widgets::gauge::Gauge<'_>"),
        ];
        let snapshot = snapshot_from(&calls, 1, 80, 24);
        let roles: Vec<Role> = snapshot.nodes.iter().map(|node| node.role).collect();
        assert_eq!(roles, [Role::Text, Role::List, Role::ProgressBar]);
    }

    /// An application's own widget must survive as something a test can find.
    #[test]
    fn an_unrecognised_widget_keeps_its_own_type_name() {
        let calls = [call(0, "my_app::widgets::WeatherGlyph")];
        let mut snapshot = snapshot_from(&calls, 1, 80, 24);
        validated(&mut snapshot);

        let node = &snapshot.nodes[0];
        assert_eq!(node.role, Role::Generic);
        assert_eq!(
            node.framework_type.as_deref(),
            Some("my_app::widgets::WeatherGlyph")
        );
    }

    /// The claim this framework cannot make, asserted so nobody quietly makes it.
    #[test]
    fn nothing_claims_pointer_ownership() {
        let calls = [
            call(0, "ratatui_widgets::block::Block<'_>"),
            call(1, "ratatui_widgets::clear::Clear"),
        ];
        let snapshot = snapshot_from(&calls, 1, 80, 24);
        assert!(matches!(
            snapshot.hit_grid,
            Observation::Unsupported { ref capability, .. } if capability == "pointer-hit-grid"
        ));
    }

    /// Ids are frame-local, and they say so.
    ///
    /// A consumer that correlates them across frames gets a visible mismatch
    /// rather than a plausible lie — which is the whole reason the frame
    /// number is in the id rather than only in the handshake.
    #[test]
    fn identity_does_not_survive_the_frame() {
        let calls = [call(0, "ratatui_widgets::paragraph::Paragraph<'_>")];
        let first = snapshot_from(&calls, 1, 80, 24);
        let second = snapshot_from(&calls, 2, 80, 24);
        assert_ne!(first.nodes[0].id, second.nodes[0].id);
        assert_eq!(first.nodes[0].id, "f1:0");
        assert_eq!(second.nodes[0].id, "f2:0");
    }

    #[test]
    fn annotation_overrides_intent_but_not_physical_facts() {
        let mut annotated = call(0, "my_app::DeployWidget");
        annotated.x = 3;
        annotated.y = 4;
        annotated.annotation = Some(
            Annotation::new()
                .role(Role::Button)
                .name("Deploy")
                .description("Deploy the current release")
                .test_id("deploy-release")
                .action(crate::Action::Activate)
                .domain("deploymentStatus", serde_json::json!("ready"))
                // These names remain domain JSON. They cannot become an
                // action, geometry or state backdoor.
                .domain("actions", serde_json::json!(["click"]))
                .domain("bounds", serde_json::json!({"row": 99}))
                .domain("state", serde_json::json!({"focused": true})),
        );

        let mut snapshot = snapshot_from(&[annotated], 7, 80, 24);
        validated(&mut snapshot);
        let node = &snapshot.nodes[0];

        assert_eq!(node.role, Role::Button);
        assert_eq!(node.name, "Deploy");
        assert_eq!(
            node.description.as_deref(),
            Some("Deploy the current release")
        );
        assert_eq!(node.test_id.as_deref(), Some("deploy-release"));
        assert!(matches!(
            node.geometry.intended_rect,
            Observation::Known { value, .. } if value == Rect::new(4, 3, 20, 1)
        ));
        assert_eq!(node.actions, Some(vec![crate::Action::Activate]));
        assert!(node.state.is_none());
        assert_eq!(node.p, Some(Provenance::Framework));
        let px = node.px.as_ref().expect("per-field provenance");
        for field in [
            "role",
            "name",
            "description",
            "testId",
            "extended",
            "actions",
        ] {
            assert_eq!(px.get(field), Some(&Provenance::Annotation), "{field}");
        }
        let extended = node.extended.as_ref().expect("domain state");
        assert_eq!(extended["deploymentStatus"], serde_json::json!("ready"));
        assert_eq!(extended["actions"], serde_json::json!(["click"]));
    }

    #[test]
    fn a_stable_test_id_does_not_fabricate_stable_identity() {
        let mut annotated = call(0, "my_app::DeployWidget");
        annotated.annotation = Some(Annotation::new().test_id("deploy-release"));

        let first = snapshot_from(std::slice::from_ref(&annotated), 1, 80, 24);
        let second = snapshot_from(&[annotated], 2, 80, 24);

        assert_eq!(first.nodes[0].test_id, second.nodes[0].test_id);
        assert_ne!(first.nodes[0].id, second.nodes[0].id);
        assert_eq!(first.nodes[0].id, "f1:0");
        assert_eq!(second.nodes[0].id, "f2:0");
    }

    #[test]
    fn semantic_key_is_stable_and_resolves_relationships_per_frame() {
        let mut label = call(0, "my_app::Label");
        label.annotation = Some(
            Annotation::new()
                .semantic_key("deployment-label")
                .role(Role::Text)
                .name("Deployment"),
        );
        let mut deploy = call(1, "my_app::DeployWidget");
        deploy.annotation = Some(
            Annotation::new()
                .semantic_key("deployment-control")
                .role(Role::Button)
                .labelled_by("deployment-label")
                .described_by("deployment-label"),
        );

        let first = snapshot_from(&[label.clone(), deploy.clone()], 1, 80, 24);
        let mut second = snapshot_from(&[label, deploy], 2, 80, 24);
        validated(&mut second);

        assert_eq!(first.nodes[0].id, "k:deployment-label");
        assert_eq!(first.nodes[1].id, "k:deployment-control");
        assert_eq!(first.nodes[1].id, second.nodes[1].id);
        assert_eq!(
            second.nodes[1].labelled_by.as_deref(),
            Some(["k:deployment-label".to_owned()].as_slice())
        );
        assert_eq!(second.nodes[1].described_by, second.nodes[1].labelled_by);
        assert_eq!(
            second.nodes[1].px.as_ref().and_then(|px| px.get("id")),
            Some(&Provenance::Annotation)
        );
    }

    #[test]
    fn negotiated_relation_limit_is_applied_before_wire_validation() {
        let labels: Vec<RenderCall> = (0..3)
            .map(|ordinal| {
                let mut label = call(ordinal, "my_app::Label");
                label.annotation = Some(
                    Annotation::new()
                        .semantic_key(format!("label-{ordinal}"))
                        .role(Role::Text),
                );
                label
            })
            .collect();
        let mut control = call(3, "my_app::Control");
        control.annotation = Some(
            Annotation::new()
                .semantic_key("control")
                .role(Role::Button)
                .labelled_by("label-0")
                .labelled_by("label-1")
                .labelled_by("label-2")
                .described_by("label-0")
                .described_by("label-1"),
        );
        let mut calls = labels;
        calls.push(control);

        let snapshot = snapshot_from_with_relation_limit(&calls, 1, 80, 24, 1);
        let node = snapshot
            .nodes
            .iter()
            .find(|node| node.id == "k:control")
            .expect("annotated control");
        assert_eq!(
            node.labelled_by.as_deref(),
            Some(["k:label-0".to_owned()].as_slice())
        );
        assert_eq!(
            node.described_by.as_deref(),
            Some(["k:label-0".to_owned()].as_slice())
        );
    }

    #[test]
    fn duplicate_semantic_keys_fail_closed() {
        let mut first = call(0, "my_app::First");
        first.annotation = Some(Annotation::new().semantic_key("duplicate"));
        let mut second = call(1, "my_app::Second");
        second.annotation = Some(Annotation::new().semantic_key("duplicate"));

        let calls = [first, second];
        assert_eq!(duplicate_semantic_key(&calls), Some("duplicate"));
        assert!(std::panic::catch_unwind(|| snapshot_from(&calls, 9, 80, 24)).is_err());
    }

    #[test]
    fn intended_geometry_is_the_rectangle_the_widget_was_drawn_into() {
        let calls = [RenderCall {
            ordinal: 0,
            type_name: "ratatui_widgets::paragraph::Paragraph<'_>",
            x: 3,
            y: 4,
            width: 10,
            height: 2,
            collection: None,
            annotation: None,
        }];
        let snapshot = snapshot_from(&calls, 1, 80, 24);
        let Observation::Known { value: bounds, .. } = snapshot.nodes[0].geometry.intended_rect
        else {
            panic!("intended geometry is not known")
        };
        assert_eq!((bounds.column, bounds.row), (3, 4));
        assert_eq!((bounds.width, bounds.height), (10, 2));
    }

    #[test]
    fn generics_are_stripped_from_the_type_name() {
        assert_eq!(
            strip_generics("ratatui_widgets::paragraph::Paragraph<'_>"),
            "ratatui_widgets::paragraph::Paragraph"
        );
        assert_eq!(strip_generics("my_app::Plain"), "my_app::Plain");
        assert_eq!(strip_generics("&my_app::Plain"), "my_app::Plain");
        assert_eq!(strip_generics("&mut my_app::Widget<'_>"), "my_app::Widget");
    }

    #[test]
    fn an_empty_frame_is_a_legal_tree() {
        let mut snapshot = snapshot_from(&[], 7, 80, 24);
        validated(&mut snapshot);
        assert!(snapshot.nodes.is_empty());
    }

    #[test]
    fn frame_preserves_what_ratatui_knows_and_refuses_hit_testing() {
        let calls = [RenderCall {
            ordinal: 0,
            type_name: "ratatui_widgets::paragraph::Paragraph<'_>",
            x: 75,
            y: 23,
            width: 10,
            height: 2,
            collection: None,
            annotation: None,
        }];
        let mut snapshot = snapshot_from_with_relation_limit(&calls, 1, 80, 24, 16);
        validated(&mut snapshot);

        assert_eq!(snapshot.v, 2);
        assert!(matches!(
            snapshot.hit_grid,
            Observation::Unsupported { ref capability, .. } if capability == "pointer-hit-grid"
        ));
        let geometry = &snapshot.nodes[0].geometry;
        assert!(matches!(
            geometry.displayed,
            Observation::Unsupported { ref capability, ref reason }
                if capability == "displayed" && reason == "framework-unobservable"
        ));
        assert!(matches!(
            geometry.intended_rect,
            Observation::Known {
                value: Rect {
                    row: 23,
                    column: 75,
                    width: 10,
                    height: 2
                },
                ..
            }
        ));
        assert!(matches!(
            geometry.visible_rect,
            Observation::Known {
                value: Rect {
                    row: 23,
                    column: 75,
                    width: 5,
                    height: 1
                },
                ..
            }
        ));
    }
}
