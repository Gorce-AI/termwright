//! Turning two consecutive trees into the delta between them.
//!
//! Producing a delta is the mirror of composing one, and it has to agree with
//! [`crate::apply_tree_delta`] exactly: whatever this emits, the driver
//! applies, and any disagreement shows up as a tree that silently drifts from
//! the screen.
//!
//! Two rules here are easy to get wrong and both are load-bearing:
//!
//! * a node that *survives* under a parent being removed must be re-sent in
//!   `changed`, even when nothing about it changed, because the removal
//!   cascades through it first;
//! * `rootIds` must be sent whenever the inherited list — the base's roots
//!   minus whatever the removals took — is not the list the new tree wants.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

/// The point past which a delta stops paying for itself: beyond roughly half
/// the tree, the whole snapshot is cheaper to send and far cheaper to reason
/// about.
pub const DELTA_SHARE_CEILING: f64 = 0.5;

fn nodes_of(tree: &Value) -> &[Value] {
    tree.get("nodes")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn id_of(node: &Value) -> &str {
    node.get("id").and_then(Value::as_str).unwrap_or_default()
}

/// Build the `tree-delta` body, or `None` when a whole snapshot is the better
/// answer.
///
/// Returning `None` is not a failure: past roughly half the tree a delta costs
/// more than the snapshot it replaces, and a cursor that disappears cannot be
/// expressed as a delta at all.
pub fn build_delta(base: &Value, next: &Value) -> Option<Value> {
    let (changed, removed, root_ids, cursor_changed) = diff_trees(base, next);

    let count = nodes_of(next).len().max(1);
    if changed.len() as f64 > count as f64 * DELTA_SHARE_CEILING {
        return None;
    }
    if base.get("cursor").is_some() && next.get("cursor").is_none() {
        // A delta can replace a cursor but never remove one, and an absent
        // cursor is inherited — so the only honest way to drop it is a whole
        // tree. Sending the delta anyway would leave the driver holding a
        // cursor the application no longer reports.
        return None;
    }

    let mut delta = Map::new();
    delta.insert("type".into(), Value::from("tree-delta"));
    delta.insert("baseRevision".into(), base.get("revision").cloned()?);
    delta.insert("revision".into(), next.get("revision").cloned()?);
    delta.insert("changed".into(), Value::Array(changed));
    delta.insert("removed".into(), Value::Array(removed));
    if let Some(root_ids) = root_ids {
        delta.insert("rootIds".into(), Value::Array(root_ids));
    }
    // An absent cursor means unchanged, so it travels only when it moved.
    if cursor_changed {
        if let Some(cursor) = next.get("cursor") {
            delta.insert("cursor".into(), cursor.clone());
        }
    }
    Some(Value::Object(delta))
}

/// Report what changed, what was removed, the root list when it can no longer
/// be inherited, and whether the cursor moved.
pub fn diff_trees(
    base: &Value,
    next: &Value,
) -> (Vec<Value>, Vec<Value>, Option<Vec<Value>>, bool) {
    let base_nodes = nodes_of(base);
    let next_nodes = nodes_of(next);

    let mut base_by_id: HashMap<&str, &Value> = HashMap::with_capacity(base_nodes.len());
    let mut children_of: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in base_nodes {
        base_by_id.insert(id_of(node), node);
        if let Some(parent) = node.get("parentId").and_then(Value::as_str) {
            children_of.entry(parent).or_default().push(id_of(node));
        }
    }
    let next_by_id: HashMap<&str, &Value> =
        next_nodes.iter().map(|node| (id_of(node), node)).collect();

    let gone: HashSet<&str> = base_by_id
        .keys()
        .copied()
        .filter(|id| !next_by_id.contains_key(id))
        .collect();

    // Only the topmost id of each removed subtree needs sending: the cascade
    // takes the rest, which is what makes a delta small.
    let mut removal_roots: Vec<&str> = gone
        .iter()
        .copied()
        .filter(
            |id| match base_by_id[id].get("parentId").and_then(Value::as_str) {
                Some(parent) => !gone.contains(parent),
                None => true,
            },
        )
        .collect();
    removal_roots.sort_unstable();

    // Everything the cascade will take, so survivors underneath can be re-sent.
    let mut swept: HashSet<&str> = HashSet::new();
    let mut pending: Vec<&str> = removal_roots.clone();
    while let Some(current) = pending.pop() {
        if !swept.insert(current) {
            continue;
        }
        if let Some(children) = children_of.get(current) {
            pending.extend(children.iter().copied());
        }
    }

    // Walk `next` in its own order so the delta is deterministic.
    let changed: Vec<Value> = next_nodes
        .iter()
        .filter(|node| {
            let id = id_of(node);
            match base_by_id.get(id) {
                None => true,
                Some(previous) => swept.contains(id) || *previous != *node,
            }
        })
        .cloned()
        .collect();

    let removed: Vec<Value> = removal_roots.iter().map(|id| Value::from(*id)).collect();

    let survivors: HashSet<&str> = base_by_id
        .keys()
        .copied()
        .filter(|id| !swept.contains(id))
        .chain(next_by_id.keys().copied())
        .collect();
    let inherited: Vec<&str> =
        base.get("rootIds")
            .and_then(Value::as_array)
            .map_or(Vec::new(), |roots| {
                roots
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|id| survivors.contains(id))
                    .collect()
            });
    let wanted: Vec<&str> = next
        .get("rootIds")
        .and_then(Value::as_array)
        .map_or(Vec::new(), |roots| {
            roots.iter().filter_map(Value::as_str).collect()
        });
    let root_ids = if inherited == wanted {
        None
    } else {
        Some(wanted.iter().map(|id| Value::from(*id)).collect())
    };

    let cursor_changed = base.get("cursor") != next.get("cursor");
    (changed, removed, root_ids, cursor_changed)
}
