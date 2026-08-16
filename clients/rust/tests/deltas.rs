//! Delta composition against the shared `delta + base → result` vectors.

mod support;

use std::collections::BTreeMap;

use serde_json::Value;

use termwright_protocol::{apply_tree_delta, validate_tree_delta, Limits, DEFAULT_LIMITS};

/// DEFAULT_LIMITS merged with the case's override, as the vectors define.
fn limits_for(case: &Value) -> Limits {
    let mut merged = serde_json::to_value(DEFAULT_LIMITS).expect("limits serialise");
    if let Some(overrides) = case.get("limitsOverride").and_then(Value::as_object) {
        let target = merged.as_object_mut().expect("limits are an object");
        for (key, value) in overrides {
            target.insert(key.clone(), value.clone());
        }
    }
    serde_json::from_value(merged).expect("limits shape")
}

/// Nodes keyed by id.
///
/// The order of `nodes` in a composed snapshot is NOT normative: the reference
/// composes through an insertion-ordered map, a client backed by a hash map
/// reports another order, and both are correct.
fn nodes_by_id(snapshot: &Value) -> BTreeMap<String, String> {
    snapshot
        .get("nodes")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .map(|node| {
                    let id = node
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    (id, node.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn cases() -> Vec<Value> {
    support::vectors("deltas")["cases"]
        .as_array()
        .expect("cases array")
        .clone()
}

fn case_named(name: &str) -> Value {
    cases()
        .into_iter()
        .find(|case| case["name"] == name)
        .unwrap_or_else(|| panic!("vector {name} is missing"))
}

#[test]
fn composition_matches_the_reference() {
    for case in cases() {
        let name = case["name"].as_str().unwrap().to_owned();
        let limits = limits_for(&case);

        // Every fixture's delta is shape-valid; composition is under test.
        validate_tree_delta(&case["delta"], &limits)
            .unwrap_or_else(|error| panic!("{name}: fixture delta is malformed: {error}"));

        let outcome = apply_tree_delta(&case["base"], &case["delta"], &limits);
        let expect = &case["expect"];

        if expect["ok"] == Value::Bool(false) {
            let error = outcome.expect_err(&format!(
                "{name}: a composition that should have failed produced a tree"
            ));
            assert_eq!(
                error.code,
                expect["code"].as_str().unwrap(),
                "{name}: {error}"
            );
            continue;
        }

        let composed =
            outcome.unwrap_or_else(|error| panic!("{name}: composition failed: {error}"));
        let want = &expect["snapshot"];

        assert_eq!(
            nodes_by_id(&composed),
            nodes_by_id(want),
            "{name}: composed nodes differ"
        );
        assert_eq!(composed["revision"], want["revision"], "{name}: revision");
        assert_eq!(composed.get("cursor"), want.get("cursor"), "{name}: cursor");
        assert_eq!(
            composed["columns"], want["columns"],
            "{name}: the viewport is inherited"
        );
        assert_eq!(
            composed["rows"], want["rows"],
            "{name}: the viewport is inherited"
        );

        let mut got_roots: Vec<&str> = composed["rootIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        let mut want_roots: Vec<&str> = want["rootIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        got_roots.sort_unstable();
        want_roots.sort_unstable();
        assert_eq!(got_roots, want_roots, "{name}: roots");
    }
}

/// The single most likely place to diverge: a merging implementation passes
/// every other case in the file and fails only here, because `state` survives
/// when it should have been replaced away.
#[test]
fn an_upsert_replaces_a_node_rather_than_merging_it() {
    let case = case_named("upsert-replaces-node-wholesale");
    let composed =
        apply_tree_delta(&case["base"], &case["delta"], &DEFAULT_LIMITS).expect("compose");
    let approve = composed["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "approve")
        .expect("the replaced node vanished");
    assert!(
        approve.get("state").is_none(),
        "state survived a wholesale replacement"
    );
}

#[test]
fn a_removal_takes_the_whole_subtree() {
    let case = case_named("remove-cascades-to-the-subtree");
    let composed =
        apply_tree_delta(&case["base"], &case["delta"], &DEFAULT_LIMITS).expect("compose");
    // Dropping the dialog costs one id and takes its three descendants with it.
    let survivors = nodes_by_id(&composed);
    assert_eq!(survivors.keys().collect::<Vec<_>>(), vec!["root"]);
    assert_eq!(case["delta"]["removed"].as_array().unwrap().len(), 1);
}

#[test]
fn removals_are_applied_before_upserts() {
    let case = case_named("rescue-a-node-out-of-a-removed-subtree");
    let composed =
        apply_tree_delta(&case["base"], &case["delta"], &DEFAULT_LIMITS).expect("compose");
    let survivors = nodes_by_id(&composed);
    assert_eq!(
        survivors.len(),
        2,
        "survivors: {:?}",
        survivors.keys().collect::<Vec<_>>()
    );
    assert!(survivors.contains_key("approve"));
    let approve = composed["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "approve")
        .unwrap();
    assert_eq!(
        approve["parentId"], "root",
        "the rescued node kept its old parent"
    );
}

#[test]
fn a_disagreeing_base_is_reported_not_patched() {
    for name in [
        "base-revision-mismatch-resyncs",
        "base-revision-ahead-resyncs",
    ] {
        let case = case_named(name);
        let error = apply_tree_delta(&case["base"], &case["delta"], &DEFAULT_LIMITS)
            .expect_err(&format!("{name} was patched around"));
        assert_eq!(error.code, "revision", "{name}");
    }
}

// -- producing deltas, with composition as the oracle ----------------------

use serde_json::json;
use termwright_protocol::build_delta;

fn wire_tree(revision: i64, nodes: Value, root_ids: Value, cursor: Option<Value>) -> Value {
    let mut tree = json!({
        "v": 1, "sessionId": "s-1", "revision": revision,
        "columns": 80, "rows": 24, "rootIds": root_ids, "nodes": nodes,
    });
    if let Some(cursor) = cursor {
        tree["cursor"] = cursor;
    }
    tree
}

fn producer_base() -> Value {
    wire_tree(
        1,
        json!([
            { "id": "root", "role": "region", "name": "main" },
            { "id": "dialog", "parentId": "root", "role": "dialog", "name": "Permission" },
            { "id": "ok", "parentId": "dialog", "role": "button", "name": "Approve" },
            { "id": "no", "parentId": "dialog", "role": "button", "name": "Reject" },
        ]),
        json!(["root"]),
        None,
    )
}

/// The oracle: whatever the producer emits must compose back into exactly the
/// tree it claims to describe.
fn assert_round_trips(base: &Value, wanted: &Value) -> Value {
    let delta = build_delta(base, wanted).expect("expected a delta, got a snapshot fallback");
    validate_tree_delta(&delta, &DEFAULT_LIMITS).expect("the produced delta is malformed");
    let composed =
        apply_tree_delta(base, &delta, &DEFAULT_LIMITS).expect("composing it back failed");
    assert_eq!(
        nodes_by_id(&composed),
        nodes_by_id(wanted),
        "the delta does not describe the tree"
    );
    assert_eq!(composed.get("cursor"), wanted.get("cursor"), "cursor");
    delta
}

#[test]
fn a_changed_node_round_trips() {
    let wanted = wire_tree(
        2,
        json!([
            { "id": "root", "role": "region", "name": "main" },
            { "id": "dialog", "parentId": "root", "role": "dialog", "name": "Permission" },
            { "id": "ok", "parentId": "dialog", "role": "button", "name": "Approve",
              "state": { "focused": true } },
            { "id": "no", "parentId": "dialog", "role": "button", "name": "Reject" },
        ]),
        json!(["root"]),
        None,
    );
    let delta = assert_round_trips(&producer_base(), &wanted);
    assert_eq!(
        delta["changed"].as_array().unwrap().len(),
        1,
        "only the changed node travels"
    );
}

#[test]
fn a_removed_subtree_costs_one_id() {
    let wanted = wire_tree(
        2,
        json!([{ "id": "root", "role": "region", "name": "main" }]),
        json!(["root"]),
        None,
    );
    let delta = assert_round_trips(&producer_base(), &wanted);
    assert_eq!(
        delta["removed"],
        json!(["dialog"]),
        "the cascade should cover the buttons"
    );
}

/// The failure that produces a tree the driver believes and the screen
/// contradicts: the node is unchanged, so a naive diff omits it, and the
/// removal of its old parent quietly deletes it.
#[test]
fn a_survivor_under_a_removed_parent_is_resent() {
    let wanted = wire_tree(
        2,
        json!([
            { "id": "root", "role": "region", "name": "main" },
            { "id": "ok", "parentId": "root", "role": "button", "name": "Approve" },
        ]),
        json!(["root"]),
        None,
    );
    let delta = assert_round_trips(&producer_base(), &wanted);
    assert_eq!(
        delta["changed"].as_array().unwrap().len(),
        1,
        "the rescued node must be re-sent"
    );
    assert_eq!(delta["removed"], json!(["dialog"]));
}

#[test]
fn a_new_root_carries_the_root_list() {
    let base = producer_base();
    let mut nodes = base["nodes"].as_array().unwrap().clone();
    nodes.push(json!({ "id": "aside", "role": "region", "name": "Aside" }));
    let wanted = wire_tree(2, Value::Array(nodes), json!(["root", "aside"]), None);

    let delta = assert_round_trips(&base, &wanted);
    assert_eq!(delta["rootIds"], json!(["root", "aside"]));
}

#[test]
fn an_unchanged_root_list_is_not_sent() {
    let base = producer_base();
    let mut nodes = base["nodes"].as_array().unwrap().clone();
    nodes.push(json!({ "id": "note", "parentId": "dialog", "role": "text", "name": "Note" }));
    let wanted = wire_tree(2, Value::Array(nodes), json!(["root"]), None);

    let delta = build_delta(&base, &wanted).expect("delta");
    assert!(
        delta.get("rootIds").is_none(),
        "the inherited root list was re-sent"
    );
}

#[test]
fn a_cursor_that_disappears_forces_a_whole_tree() {
    let mut with_cursor = producer_base();
    with_cursor["cursor"] = json!({ "row": 1, "column": 1, "visible": true });
    let without = wire_tree(2, with_cursor["nodes"].clone(), json!(["root"]), None);

    assert!(
        build_delta(&with_cursor, &without).is_none(),
        "a delta cannot remove a cursor"
    );
}

#[test]
fn a_rewrite_of_most_of_the_tree_falls_back_to_a_snapshot() {
    let wanted = wire_tree(
        2,
        json!([
            { "id": "root", "role": "region", "name": "renamed" },
            { "id": "dialog", "parentId": "root", "role": "dialog", "name": "renamed" },
            { "id": "ok", "parentId": "dialog", "role": "button", "name": "renamed" },
            { "id": "no", "parentId": "dialog", "role": "button", "name": "renamed" },
        ]),
        json!(["root"]),
        None,
    );
    assert!(
        build_delta(&producer_base(), &wanted).is_none(),
        "a near-total rewrite is not a delta"
    );
}
