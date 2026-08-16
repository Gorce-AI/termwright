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
//! - **Frame-local ids.** `Widget::render` takes `self` by value, so the
//!   widget is gone by the time the call returns and nothing survives to be
//!   named again next frame. Ids carry the frame number for that reason: a
//!   consumer that tries to correlate them across frames gets a visible
//!   mismatch rather than a plausible lie.
//! - **`occlusion: "unknown"` everywhere.** Ratatui exposes no paint order,
//!   so nothing here can answer "is my target actually the thing at this
//!   cell". The driver refuses pointer actions against such nodes, which is
//!   the correct outcome for this framework rather than a gap to fill in.
//!
//! `bounds` carries the rectangle the widget was drawn *into*. That is intent,
//! not ownership — a later write silently wins — and `occlusion` is exactly
//! the field that says so.

use termwright_protocol::tree::{Node, Occlusion, Provenance, Rect, Snapshot, State};
use termwright_protocol::Role;

use crate::RenderCall;

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
    match type_name.find('<') {
        Some(index) => type_name[..index].trim_end(),
        None => type_name,
    }
}

/// Build the tree for one frame.
///
/// `frame` is the frame counter Ratatui already keeps. It goes into every id
/// because the ids are worth nothing outside their frame, and saying so in the
/// id itself is cheaper than hoping a consumer read the handshake.
#[must_use]
pub fn snapshot_from(calls: &[RenderCall], frame: u64, columns: u16, rows: u16) -> Snapshot {
    let mut snapshot = Snapshot::new(i64::from(columns), i64::from(rows));
    for call in calls {
        let type_path = strip_generics(call.type_name);
        let role = role_for(type_path);
        let mut node = Node::new(
            format!("f{frame}:{}", call.ordinal),
            role.unwrap_or(Role::Generic),
            "",
        );
        node.bounds = Some(Rect {
            row: i64::from(call.y),
            column: i64::from(call.x),
            width: i64::from(call.width),
            height: i64::from(call.height),
        });
        // No paint order is observable, so no node may claim its cells are
        // uncovered. The driver refuses pointer actions on these.
        node.occlusion = Some(Occlusion::Unknown);
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
        item.occlusion = Some(Occlusion::Unknown);
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
    fn nothing_claims_to_know_about_occlusion() {
        let calls = [
            call(0, "ratatui_widgets::block::Block<'_>"),
            call(1, "ratatui_widgets::clear::Clear"),
        ];
        let snapshot = snapshot_from(&calls, 1, 80, 24);
        assert!(snapshot
            .nodes
            .iter()
            .all(|node| node.occlusion == Some(Occlusion::Unknown)));
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
    fn bounds_are_the_rectangle_the_widget_was_drawn_into() {
        let calls = [RenderCall {
            ordinal: 0,
            type_name: "ratatui_widgets::paragraph::Paragraph<'_>",
            x: 3,
            y: 4,
            width: 10,
            height: 2,
            collection: None,
        }];
        let snapshot = snapshot_from(&calls, 1, 80, 24);
        let bounds = snapshot.nodes[0].bounds.expect("bounds");
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
    }

    #[test]
    fn an_empty_frame_is_a_legal_tree() {
        let mut snapshot = snapshot_from(&[], 7, 80, 24);
        validated(&mut snapshot);
        assert!(snapshot.nodes.is_empty());
    }
}
