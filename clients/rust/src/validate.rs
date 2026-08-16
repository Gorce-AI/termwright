//! Snapshot validation.
//!
//! A structural port of the reference `validate.ts`: same invariants, same
//! error codes, same order of checks, so a snapshot rejected here is rejected
//! by the driver and vice versa. Never panics on hostile input.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::error::ValidationError;
use crate::framing::project_dto;
use crate::limits::Limits;
use crate::marker::MAX_SAFE_INTEGER;
use crate::roles::{valid_action, valid_role};

/// A schema defect, carrying the path the reference implementation reports.
/// The path is what decides the error code.
struct Issue {
    path: Vec<String>,
    message: String,
    too_big: bool,
}

impl Issue {
    fn new(path: Vec<String>, message: impl Into<String>) -> Self {
        Self {
            path,
            message: message.into(),
            too_big: false,
        }
    }

    fn too_big(path: Vec<String>, message: impl Into<String>) -> Self {
        Self {
            path,
            message: message.into(),
            too_big: true,
        }
    }

    fn code(&self) -> &'static str {
        let has = |key: &str| self.path.iter().any(|element| element == key);
        if has("role") {
            "unknown-role"
        } else if has("revision") {
            "revision"
        } else if has("bounds") || has("rect") {
            "bad-rect"
        } else if self.too_big && (has("nodes") || has("rootIds")) {
            "count"
        } else if self.message.contains("UTF-8 bytes") {
            "string-bytes"
        } else {
            "schema"
        }
    }

    fn into_error(self) -> ValidationError {
        let where_ = if self.path.is_empty() {
            "<root>".to_owned()
        } else {
            self.path.join(".")
        };
        let code = self.code();
        ValidationError::new(code, format!("{where_}: {}", self.message))
    }
}

fn path(base: &[String], more: &[&str]) -> Vec<String> {
    let mut next: Vec<String> = base.to_vec();
    next.extend(more.iter().map(|element| (*element).to_owned()));
    next
}

// -- scalar checks ---------------------------------------------------------

fn as_object<'a>(value: &'a Value, at: &[String]) -> Result<&'a Map<String, Value>, Issue> {
    value
        .as_object()
        .ok_or_else(|| Issue::new(at.to_vec(), "expected an object"))
}

fn strict(object: &Map<String, Value>, allowed: &[&str], at: &[String]) -> Result<(), Issue> {
    let mut unknown: Vec<&str> = object
        .keys()
        .map(String::as_str)
        .filter(|key| !allowed.contains(key))
        .collect();
    if unknown.is_empty() {
        return Ok(());
    }
    unknown.sort_unstable();
    Err(Issue::new(
        at.to_vec(),
        format!("Unrecognized key(s) in object: {}", unknown.join(", ")),
    ))
}

fn whole(
    value: Option<&Value>,
    at: Vec<String>,
    message: &str,
    ok: impl Fn(i64) -> bool,
) -> Result<i64, Issue> {
    let number = value
        .and_then(Value::as_i64)
        .filter(|n| n.abs() <= MAX_SAFE_INTEGER);
    match number {
        Some(number) if ok(number) => Ok(number),
        _ => Err(Issue::new(at, message)),
    }
}

fn safe_int(value: Option<&Value>, at: Vec<String>) -> Result<i64, Issue> {
    whole(value, at, "expected a safe integer", |_| true)
}

fn non_negative(value: Option<&Value>, at: Vec<String>) -> Result<i64, Issue> {
    whole(value, at, "expected a non-negative safe integer", |n| {
        n >= 0
    })
}

fn positive(value: Option<&Value>, at: Vec<String>) -> Result<i64, Issue> {
    whole(value, at, "expected a positive safe integer", |n| n > 0)
}

fn text<'a>(value: Option<&'a Value>, at: Vec<String>, limits: &Limits) -> Result<&'a str, Issue> {
    let Some(text) = value.and_then(Value::as_str) else {
        return Err(Issue::new(at, "expected a string"));
    };
    if text.len() > limits.max_string_bytes {
        return Err(Issue::new(
            at,
            format!("expected at most {} UTF-8 bytes", limits.max_string_bytes),
        ));
    }
    Ok(text)
}

fn boolean(value: Option<&Value>, at: Vec<String>) -> Result<bool, Issue> {
    value
        .and_then(Value::as_bool)
        .ok_or_else(|| Issue::new(at, "expected a boolean"))
}

// -- schema layer ----------------------------------------------------------

const RECT_KEYS: [&str; 4] = ["row", "column", "width", "height"];

fn check_rect(value: &Value, at: &[String]) -> Result<Rect, Issue> {
    let object = as_object(value, at)?;
    strict(object, &RECT_KEYS, at)?;
    Ok(Rect {
        row: safe_int(object.get("row"), path(at, &["row"]))?,
        column: safe_int(object.get("column"), path(at, &["column"]))?,
        width: non_negative(object.get("width"), path(at, &["width"]))?,
        height: non_negative(object.get("height"), path(at, &["height"]))?,
    })
}

/// The four numbers of a rect, once they are known to be well-formed.
struct Rect {
    row: i64,
    column: i64,
    width: i64,
    height: i64,
}

const STATE_BOOL_KEYS: [&str; 9] = [
    "disabled",
    "focused",
    "selected",
    "expanded",
    "modal",
    "busy",
    "hidden",
    "readonly",
    "multiline",
];

/// Every field a `state` object may carry, as this client knows them.
pub const STATE_KEYS: [&str; 16] = [
    "disabled",
    "focused",
    "selected",
    "expanded",
    "modal",
    "busy",
    "hidden",
    "readonly",
    "multiline",
    "checked",
    "orientation",
    "level",
    "positionInSet",
    "setSize",
    "scrollOffset",
    "scrollExtent",
];

fn check_state(value: &Value, at: &[String]) -> Result<(), Issue> {
    let object = as_object(value, at)?;
    strict(object, &STATE_KEYS, at)?;
    for key in STATE_BOOL_KEYS {
        if object.contains_key(key) {
            boolean(object.get(key), path(at, &[key]))?;
        }
    }
    if let Some(checked) = object.get("checked") {
        if !checked.is_boolean() && checked.as_str() != Some("mixed") {
            return Err(Issue::new(
                path(at, &["checked"]),
                "expected a boolean or 'mixed'",
            ));
        }
    }
    if let Some(orientation) = object.get("orientation") {
        if !matches!(orientation.as_str(), Some("horizontal") | Some("vertical")) {
            return Err(Issue::new(
                path(at, &["orientation"]),
                "expected 'horizontal' or 'vertical'",
            ));
        }
    }
    for key in ["level", "positionInSet"] {
        if object.contains_key(key) {
            positive(object.get(key), path(at, &[key]))?;
        }
    }
    for key in ["setSize", "scrollOffset", "scrollExtent"] {
        if object.contains_key(key) {
            non_negative(object.get(key), path(at, &[key]))?;
        }
    }
    Ok(())
}

/// Every field a node may carry, as this client knows them.
pub const NODE_KEYS: [&str; 17] = [
    "id",
    "parentId",
    "role",
    "name",
    "description",
    "value",
    "bounds",
    "state",
    "actions",
    "labelledBy",
    "describedBy",
    "textRanges",
    "testId",
    "frameworkType",
    "occlusion",
    "p",
    "px",
];

/// Where a semantic fact came from. Closed set, so an unknown source is a
/// rejection rather than a silently ignored annotation.
const PROVENANCE_SOURCES: [&str; 5] = [
    "annotation",
    "recognizer",
    "framework",
    "correlation",
    "heuristic",
];

fn check_relations(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    let Some(items) = value.as_array() else {
        return Err(Issue::new(at.to_vec(), "expected an array"));
    };
    if items.len() > limits.max_relation_targets {
        return Err(Issue::too_big(
            at.to_vec(),
            format!("expected at most {} items", limits.max_relation_targets),
        ));
    }
    for (index, item) in items.iter().enumerate() {
        text(Some(item), path(at, &[&index.to_string()]), limits)?;
    }
    Ok(())
}

fn check_node_schema(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    let object = as_object(value, at)?;
    strict(object, &NODE_KEYS, at)?;

    if text(object.get("id"), path(at, &["id"]), limits)?.is_empty() {
        return Err(Issue::new(path(at, &["id"]), "node id must not be empty"));
    }
    if object.contains_key("parentId") {
        text(object.get("parentId"), path(at, &["parentId"]), limits)?;
    }
    match object.get("role").and_then(Value::as_str) {
        Some(role) if valid_role(role) => {}
        _ => {
            return Err(Issue::new(
                path(at, &["role"]),
                "expected one of the v1 semantic roles",
            ))
        }
    }
    text(object.get("name"), path(at, &["name"]), limits)?;
    for key in ["description", "value", "testId", "frameworkType"] {
        if object.contains_key(key) {
            text(object.get(key), path(at, &[key]), limits)?;
        }
    }
    if let Some(occlusion) = object.get("occlusion") {
        let known = matches!(occlusion.as_str(), Some("known") | Some("unknown"));
        if !known {
            return Err(Issue::new(
                path(at, &["occlusion"]),
                "expected 'known' or 'unknown'",
            ));
        }
    }
    if let Some(source) = object.get("p") {
        if !source
            .as_str()
            .is_some_and(|value| PROVENANCE_SOURCES.contains(&value))
        {
            return Err(Issue::new(
                path(at, &["p"]),
                "expected one of the provenance sources",
            ));
        }
    }
    if let Some(per_field) = object.get("px") {
        let Some(fields) = per_field.as_object() else {
            return Err(Issue::new(path(at, &["px"]), "expected an object"));
        };
        for (field, source) in fields {
            text(
                Some(&Value::String(field.clone())),
                path(at, &["px", field]),
                limits,
            )?;
            if !source
                .as_str()
                .is_some_and(|value| PROVENANCE_SOURCES.contains(&value))
            {
                return Err(Issue::new(
                    path(at, &["px", field]),
                    "expected one of the provenance sources",
                ));
            }
        }
    }
    if object.get("role").and_then(Value::as_str) == Some("generic") {
        // An unrecognised widget must at least name what the framework called
        // it. An empty string carries no more than its absence, so both fail.
        let named = object
            .get("frameworkType")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty());
        if !named {
            let id = object.get("id").and_then(Value::as_str).unwrap_or("");
            return Err(Issue::new(
                path(at, &["frameworkType"]),
                format!(
                    "node {id} has role 'generic' without a frameworkType; an unrecognised \
                     widget must name what the framework called it"
                ),
            ));
        }
    }
    if let Some(bounds) = object.get("bounds") {
        check_rect(bounds, &path(at, &["bounds"]))?;
    }
    if let Some(state) = object.get("state") {
        check_state(state, &path(at, &["state"]))?;
    }
    if let Some(actions) = object.get("actions") {
        let Some(items) = actions.as_array() else {
            return Err(Issue::new(path(at, &["actions"]), "expected an array"));
        };
        if items.len() > crate::roles::SEMANTIC_ACTIONS.len() {
            return Err(Issue::too_big(path(at, &["actions"]), "too many actions"));
        }
        for (index, item) in items.iter().enumerate() {
            match item.as_str() {
                Some(action) if valid_action(action) => {}
                _ => {
                    return Err(Issue::new(
                        path(at, &["actions", &index.to_string()]),
                        "expected one of the v1 semantic actions",
                    ))
                }
            }
        }
    }
    for key in ["labelledBy", "describedBy"] {
        if let Some(relations) = object.get(key) {
            check_relations(relations, &path(at, &[key]), limits)?;
        }
    }
    if let Some(ranges) = object.get("textRanges") {
        let Some(items) = ranges.as_array() else {
            return Err(Issue::new(path(at, &["textRanges"]), "expected an array"));
        };
        if items.len() > limits.max_relation_targets {
            return Err(Issue::too_big(
                path(at, &["textRanges"]),
                "too many text ranges",
            ));
        }
        for (index, item) in items.iter().enumerate() {
            let item_path = path(at, &["textRanges", &index.to_string()]);
            let entry = as_object(item, &item_path)?;
            strict(entry, &["startOffset", "endOffset", "rect"], &item_path)?;
            non_negative(entry.get("startOffset"), path(&item_path, &["startOffset"]))?;
            non_negative(entry.get("endOffset"), path(&item_path, &["endOffset"]))?;
            let rect = entry
                .get("rect")
                .ok_or_else(|| Issue::new(path(&item_path, &["rect"]), "expected an object"))?;
            check_rect(rect, &path(&item_path, &["rect"]))?;
        }
    }
    Ok(())
}

fn check_cursor(value: &Value, at: &[String]) -> Result<(), Issue> {
    let object = as_object(value, at)?;
    strict(object, &["row", "column", "visible", "shape"], at)?;
    non_negative(object.get("row"), path(at, &["row"]))?;
    non_negative(object.get("column"), path(at, &["column"]))?;
    boolean(object.get("visible"), path(at, &["visible"]))?;
    if let Some(shape) = object.get("shape") {
        if !matches!(
            shape.as_str(),
            Some("block") | Some("underline") | Some("bar")
        ) {
            return Err(Issue::new(
                path(at, &["shape"]),
                "expected 'block', 'underline' or 'bar'",
            ));
        }
    }
    Ok(())
}

const SNAPSHOT_KEYS: [&str; 8] = [
    "v",
    "sessionId",
    "revision",
    "columns",
    "rows",
    "cursor",
    "rootIds",
    "nodes",
];

fn check_snapshot_schema(value: &Value, limits: &Limits) -> Result<(), Issue> {
    let root: Vec<String> = Vec::new();
    let object = as_object(value, &root)?;
    strict(object, &SNAPSHOT_KEYS, &root)?;

    if object.get("v").and_then(Value::as_i64) != Some(1) {
        return Err(Issue::new(vec!["v".into()], "expected the literal 1"));
    }
    if text(object.get("sessionId"), vec!["sessionId".into()], limits)?.is_empty() {
        return Err(Issue::new(
            vec!["sessionId".into()],
            "sessionId must not be empty",
        ));
    }
    positive(object.get("revision"), vec!["revision".into()])?;
    positive(object.get("columns"), vec!["columns".into()])?;
    positive(object.get("rows"), vec!["rows".into()])?;
    if let Some(cursor) = object.get("cursor") {
        check_cursor(cursor, &["cursor".to_owned()])?;
    }

    let Some(root_ids) = object.get("rootIds").and_then(Value::as_array) else {
        return Err(Issue::new(vec!["rootIds".into()], "expected an array"));
    };
    if root_ids.len() > limits.max_nodes {
        return Err(Issue::too_big(
            vec!["rootIds".into()],
            format!("expected at most {} items", limits.max_nodes),
        ));
    }
    for (index, item) in root_ids.iter().enumerate() {
        text(
            Some(item),
            vec!["rootIds".into(), index.to_string()],
            limits,
        )?;
    }

    let Some(nodes) = object.get("nodes").and_then(Value::as_array) else {
        return Err(Issue::new(vec!["nodes".into()], "expected an array"));
    };
    if nodes.len() > limits.max_nodes {
        return Err(Issue::too_big(
            vec!["nodes".into()],
            format!("expected at most {} items", limits.max_nodes),
        ));
    }
    for (index, node) in nodes.iter().enumerate() {
        check_node_schema(node, &["nodes".to_owned(), index.to_string()], limits)?;
    }
    Ok(())
}

// -- structural layer ------------------------------------------------------

fn intersects_viewport(rect: &Rect, columns: i64, rows: i64) -> bool {
    rect.width != 0
        && rect.height != 0
        && rect.column < columns
        && rect.row < rows
        && rect.column + rect.width > 0
        && rect.row + rect.height > 0
}

/// Whether the sum still round-trips through a JavaScript number.
fn is_safe_sum(left: i64, right: i64) -> bool {
    matches!(left.checked_add(right), Some(sum) if sum.abs() <= MAX_SAFE_INTEGER)
}

fn node_id(node: &Map<String, Value>) -> &str {
    node.get("id").and_then(Value::as_str).unwrap_or_default()
}

fn check_node_shape(
    node: &Map<String, Value>,
    columns: i64,
    rows: i64,
    ids: &HashSet<&str>,
    limits: &Limits,
) -> Result<(), ValidationError> {
    let id = node_id(node);

    if let Some(bounds) = node.get("bounds") {
        let rect = check_rect(bounds, &[]).map_err(Issue::into_error)?;
        if !is_safe_sum(rect.row, rect.height) || !is_safe_sum(rect.column, rect.width) {
            return Err(ValidationError::new(
                "bad-rect",
                format!("node {id}: bounds overflow the safe-integer range"),
            ));
        }
        let hidden = node
            .get("state")
            .and_then(Value::as_object)
            .and_then(|state| state.get("hidden"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !hidden && !intersects_viewport(&rect, columns, rows) {
            return Err(ValidationError::new(
                "bad-rect",
                format!(
                    "node {id}: bounds do not intersect the {columns}x{rows} viewport and the node is not hidden"
                ),
            ));
        }
    }

    if let Some(ranges) = node.get("textRanges").and_then(Value::as_array) {
        for item in ranges {
            let entry = item.as_object().expect("schema layer checked the shape");
            let start = entry
                .get("startOffset")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let end = entry
                .get("endOffset")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            if end < start {
                return Err(ValidationError::new(
                    "bad-rect",
                    format!("node {id}: text range ends before it starts"),
                ));
            }
            let rect = check_rect(&entry["rect"], &[]).map_err(Issue::into_error)?;
            if !is_safe_sum(rect.row, rect.height) {
                return Err(ValidationError::new(
                    "bad-rect",
                    format!("node {id}: text range rect overflows the safe-integer range"),
                ));
            }
        }
    }

    for field in ["labelledBy", "describedBy"] {
        let Some(targets) = node.get(field).and_then(Value::as_array) else {
            continue;
        };
        if targets.len() > limits.max_relation_targets {
            return Err(ValidationError::new(
                "count",
                format!(
                    "node {id}: {field} exceeds {} targets",
                    limits.max_relation_targets
                ),
            ));
        }
        for target in targets {
            let target = target.as_str().unwrap_or_default();
            if !ids.contains(target) {
                return Err(ValidationError::new(
                    "missing-parent",
                    format!("node {id}: {field} references unknown node {target}"),
                ));
            }
        }
    }
    Ok(())
}

/// Depth of every node (roots at 1), or the id where a parent chain closes.
fn compute_depths<'a>(
    nodes: &[&'a Map<String, Value>],
    by_id: &HashMap<&'a str, &'a Map<String, Value>>,
) -> Result<HashMap<&'a str, usize>, &'a str> {
    let mut depths: HashMap<&str, usize> = HashMap::new();

    for start in nodes {
        if depths.contains_key(node_id(start)) {
            continue;
        }
        let mut chain: Vec<&str> = Vec::new();
        let mut on_chain: HashSet<&str> = HashSet::new();
        let mut current: Option<&&Map<String, Value>> = Some(start);

        while let Some(node) = current {
            let id = node_id(node);
            if depths.contains_key(id) {
                break;
            }
            if !on_chain.insert(id) {
                return Err(id);
            }
            chain.push(id);
            current = match node.get("parentId").and_then(Value::as_str) {
                Some(parent_id) => by_id.get(parent_id),
                None => None,
            };
        }

        let mut depth = current.map(|node| depths[node_id(node)]).unwrap_or(0);
        for id in chain.iter().rev() {
            depth += 1;
            depths.insert(id, depth);
        }
    }
    Ok(depths)
}

const DELTA_KEYS: [&str; 7] = [
    "type",
    "baseRevision",
    "revision",
    "changed",
    "removed",
    "rootIds",
    "cursor",
];

/// Validate the SHAPE of a `tree-delta` message.
///
/// Only the shape is checkable here. A delta carries no `columns`/`rows`, so
/// whether a parent exists, whether the tree stays acyclic and inside the
/// depth ceiling, and whether bounds or the cursor fall within the viewport
/// can only be judged once the delta is applied to its base — put the
/// assembled tree through [`validate_snapshot`] for that.
///
/// What is checkable without the base: sizes, node shape, unique ids, a
/// revision that moves forward, and the same id never both upserted and
/// removed by one delta.
///
/// # Errors
/// Returns a [`ValidationError`] whose `code` matches the reference.
pub fn validate_tree_delta(value: &Value, limits: &Limits) -> Result<(), ValidationError> {
    if let Err(violation) = project_dto(value, limits.max_depth) {
        let code = if violation.code == "dto-depth" {
            "depth"
        } else {
            "schema"
        };
        return Err(ValidationError::new(code, violation.to_string()));
    }

    let serialised = serde_json::to_vec(value)
        .map_err(|_| ValidationError::new("schema", "delta is not JSON-serialisable"))?;
    if serialised.len() > limits.max_snapshot_bytes {
        return Err(ValidationError::new(
            "bytes",
            format!(
                "delta is {} bytes, ceiling is {}",
                serialised.len(),
                limits.max_snapshot_bytes
            ),
        ));
    }

    check_tree_delta_schema(value, limits).map_err(Issue::into_error)?;
    let delta = value.as_object().expect("schema layer checked the shape");

    let mut changed_ids: HashSet<&str> = HashSet::new();
    for raw in delta["changed"]
        .as_array()
        .expect("checked by the schema layer")
    {
        let node = raw.as_object().expect("checked by the schema layer");
        let id = node_id(node);
        if !changed_ids.insert(id) {
            return Err(ValidationError::new(
                "duplicate-id",
                format!("node id {id} appears twice in changed"),
            ));
        }
        if node.get("parentId").and_then(Value::as_str) == Some(id) {
            return Err(ValidationError::new(
                "cycle",
                format!("node {id} is its own parent"),
            ));
        }
    }

    let mut removed_ids: HashSet<&str> = HashSet::new();
    for raw in delta["removed"]
        .as_array()
        .expect("checked by the schema layer")
    {
        let id = raw.as_str().unwrap_or_default();
        if !removed_ids.insert(id) {
            return Err(ValidationError::new(
                "duplicate-id",
                format!("node id {id} appears twice in removed"),
            ));
        }
    }

    if let Some(id) = changed_ids.intersection(&removed_ids).next() {
        // Removals apply before upserts, so this would be a delta arguing with
        // itself about one id rather than moving a node elsewhere.
        return Err(ValidationError::new(
            "schema",
            format!("node id {id} is both changed and removed by one delta"),
        ));
    }

    if let Some(root_ids) = delta.get("rootIds").and_then(Value::as_array) {
        let mut seen: HashSet<&str> = HashSet::new();
        for raw in root_ids {
            let id = raw.as_str().unwrap_or_default();
            if !seen.insert(id) {
                return Err(ValidationError::new(
                    "duplicate-id",
                    format!("root id {id} appears more than once"),
                ));
            }
        }
    }

    Ok(())
}

fn check_tree_delta_schema(value: &Value, limits: &Limits) -> Result<(), Issue> {
    let root: Vec<String> = Vec::new();
    let delta = as_object(value, &root)?;
    strict(delta, &DELTA_KEYS, &root)?;

    let base = positive(delta.get("baseRevision"), vec!["baseRevision".into()])?;
    let revision = positive(delta.get("revision"), vec!["revision".into()])?;
    if revision <= base {
        return Err(Issue::new(
            vec!["revision".into()],
            format!("revision {revision} must move forward from base {base}"),
        ));
    }

    let Some(changed) = delta.get("changed").and_then(Value::as_array) else {
        return Err(Issue::new(vec!["changed".into()], "expected an array"));
    };
    if changed.len() > limits.max_nodes {
        return Err(Issue::too_big(
            vec!["changed".into()],
            format!("expected at most {} items", limits.max_nodes),
        ));
    }
    for (index, node) in changed.iter().enumerate() {
        check_node_schema(node, &["changed".to_owned(), index.to_string()], limits)?;
    }

    let Some(removed) = delta.get("removed").and_then(Value::as_array) else {
        return Err(Issue::new(vec!["removed".into()], "expected an array"));
    };
    if removed.len() > limits.max_nodes {
        return Err(Issue::too_big(
            vec!["removed".into()],
            format!("expected at most {} items", limits.max_nodes),
        ));
    }
    for (index, id) in removed.iter().enumerate() {
        let at = vec!["removed".to_owned(), index.to_string()];
        if text(Some(id), at.clone(), limits)?.is_empty() {
            return Err(Issue::new(at, "node id must not be empty"));
        }
    }

    if let Some(root_ids) = delta.get("rootIds") {
        let Some(items) = root_ids.as_array() else {
            return Err(Issue::new(vec!["rootIds".into()], "expected an array"));
        };
        if items.len() > limits.max_nodes {
            return Err(Issue::too_big(
                vec!["rootIds".into()],
                format!("expected at most {} items", limits.max_nodes),
            ));
        }
        for (index, id) in items.iter().enumerate() {
            text(
                Some(id),
                vec!["rootIds".to_owned(), index.to_string()],
                limits,
            )?;
        }
    }

    if let Some(cursor) = delta.get("cursor") {
        check_cursor(cursor, &["cursor".to_owned()])?;
    }
    Ok(())
}

/// Validate an untrusted snapshot against `limits`.
///
/// Checks unique ids, existing and acyclic parents, the closed role, action
/// and state vocabularies, bounded strings and counts, and rects that
/// intersect the viewport unless the node is hidden.
///
/// # Errors
/// Returns a [`ValidationError`] whose `code` matches the reference
/// implementation's.
pub fn validate_snapshot(value: &Value, limits: &Limits) -> Result<(), ValidationError> {
    if let Err(violation) = project_dto(value, limits.max_depth) {
        let code = if violation.code == "dto-depth" {
            "depth"
        } else {
            "schema"
        };
        return Err(ValidationError::new(code, violation.to_string()));
    }

    let serialised = serde_json::to_vec(value)
        .map_err(|_| ValidationError::new("schema", "snapshot is not JSON-serialisable"))?;
    if serialised.len() > limits.max_snapshot_bytes {
        return Err(ValidationError::new(
            "bytes",
            format!(
                "snapshot is {} bytes, ceiling is {}",
                serialised.len(),
                limits.max_snapshot_bytes
            ),
        ));
    }

    check_snapshot_schema(value, limits).map_err(Issue::into_error)?;

    let snapshot = value.as_object().expect("schema layer checked the shape");
    let columns = snapshot["columns"]
        .as_i64()
        .expect("checked by the schema layer");
    let rows = snapshot["rows"]
        .as_i64()
        .expect("checked by the schema layer");

    let raw_nodes = snapshot["nodes"]
        .as_array()
        .expect("checked by the schema layer");
    if raw_nodes.len() > limits.max_nodes {
        return Err(ValidationError::new(
            "count",
            format!(
                "snapshot carries {} nodes, ceiling is {}",
                raw_nodes.len(),
                limits.max_nodes
            ),
        ));
    }

    let mut nodes: Vec<&Map<String, Value>> = Vec::with_capacity(raw_nodes.len());
    let mut by_id: HashMap<&str, &Map<String, Value>> = HashMap::with_capacity(raw_nodes.len());
    for raw in raw_nodes {
        let node = raw.as_object().expect("checked by the schema layer");
        let id = node_id(node);
        if by_id.insert(id, node).is_some() {
            return Err(ValidationError::new(
                "duplicate-id",
                format!("node id {id} appears more than once"),
            ));
        }
        nodes.push(node);
    }

    let mut root_ids: HashSet<&str> = HashSet::new();
    for raw in snapshot["rootIds"]
        .as_array()
        .expect("checked by the schema layer")
    {
        let id = raw.as_str().unwrap_or_default();
        if !root_ids.insert(id) {
            return Err(ValidationError::new(
                "duplicate-id",
                format!("root id {id} appears more than once"),
            ));
        }
        let Some(node) = by_id.get(id) else {
            return Err(ValidationError::new(
                "missing-parent",
                format!("rootIds references unknown node {id}"),
            ));
        };
        if node.contains_key("parentId") {
            return Err(ValidationError::new(
                "schema",
                format!("root node {id} declares a parent"),
            ));
        }
    }

    let ids: HashSet<&str> = by_id.keys().copied().collect();

    for node in &nodes {
        let id = node_id(node);
        match node.get("parentId").and_then(Value::as_str) {
            None => {
                if !root_ids.contains(id) {
                    return Err(ValidationError::new(
                        "schema",
                        format!("parentless node {id} is missing from rootIds"),
                    ));
                }
            }
            Some(parent_id) if !by_id.contains_key(parent_id) => {
                return Err(ValidationError::new(
                    "missing-parent",
                    format!("node {id} references unknown parent {parent_id}"),
                ));
            }
            Some(parent_id) if parent_id == id => {
                return Err(ValidationError::new(
                    "cycle",
                    format!("node {id} is its own parent"),
                ));
            }
            Some(_) => {}
        }
        check_node_shape(node, columns, rows, &ids, limits)?;
    }

    match compute_depths(&nodes, &by_id) {
        Err(cycle_at) => {
            return Err(ValidationError::new(
                "cycle",
                format!("parent chain through node {cycle_at} is cyclic"),
            ))
        }
        Ok(depths) => {
            for (id, depth) in depths {
                if depth > limits.max_depth {
                    return Err(ValidationError::new(
                        "depth",
                        format!(
                            "node {id} sits at depth {depth}, ceiling is {}",
                            limits.max_depth
                        ),
                    ));
                }
            }
        }
    }

    if let Some(cursor) = snapshot.get("cursor").and_then(Value::as_object) {
        let row = cursor["row"].as_i64().expect("checked by the schema layer");
        let column = cursor["column"]
            .as_i64()
            .expect("checked by the schema layer");
        if row >= rows || column >= columns {
            return Err(ValidationError::new(
                "bad-rect",
                format!("cursor ({row}, {column}) lies outside the viewport"),
            ));
        }
    }

    Ok(())
}

/// Compose a delta onto the snapshot it names, then validate the result.
///
/// The four composition rules, in the order they are applied:
///
/// 1. `removed` takes each id **with its whole subtree**. The cascade is what
///    keeps a delta small — dropping a dialog is one id, not one per
///    descendant — and it is the only rule that leaves no orphans behind.
/// 2. Removals happen **before** upserts, so one delta can move a node out of
///    a subtree it is deleting.
/// 3. `changed` upserts by id, **replacing a node wholesale**. Merging would
///    need a third state meaning "clear this optional field", which the wire
///    cannot express.
/// 4. `rootIds` present replaces the list; absent inherits the base's minus
///    whatever the removals took. Adding a new root therefore *requires*
///    sending `rootIds` — otherwise the parentless node is missing from the
///    root list and validation says so, loudly.
///
/// An absent `cursor` is inherited; there is no way to remove one, and none is
/// needed, because hiding it is `visible: false`.
///
/// A base that disagrees is reported rather than patched around: the caller
/// asks for a full snapshot instead of guessing (§8.3). The composed tree then
/// goes through [`validate_snapshot`], because a delta is trusted to
/// *describe* a valid tree, never to produce one.
///
/// The order of the composed `nodes` is not normative; this implementation
/// keeps base order with new nodes appended, which makes output deterministic.
///
/// # Errors
/// Returns a [`ValidationError`] whose `code` matches the reference.
pub fn apply_tree_delta(
    base: &Value,
    delta: &Value,
    limits: &Limits,
) -> Result<Value, ValidationError> {
    let base_revision = delta
        .get("baseRevision")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    let held = base.get("revision").and_then(Value::as_i64).unwrap_or(-2);
    if base_revision != held {
        return Err(ValidationError::new(
            "revision",
            format!(
                "delta is based on revision {base_revision} but the held snapshot is revision \
                 {held}; request a full snapshot instead of patching"
            ),
        ));
    }

    let empty = Vec::new();
    let base_nodes = base
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty);

    let mut order: Vec<String> = Vec::with_capacity(base_nodes.len());
    let mut by_id: HashMap<String, Value> = HashMap::with_capacity(base_nodes.len());
    let mut children_of: HashMap<String, Vec<String>> = HashMap::new();
    for node in base_nodes {
        let id = node
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if let Some(parent) = node.get("parentId").and_then(Value::as_str) {
            children_of
                .entry(parent.to_owned())
                .or_default()
                .push(id.clone());
        }
        order.push(id.clone());
        by_id.insert(id, node.clone());
    }

    for raw in delta
        .get("removed")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let id = raw.as_str().unwrap_or_default();
        if !by_id.contains_key(id) {
            return Err(ValidationError::new(
                "missing-parent",
                format!(
                    "delta removes unknown node {id}; the producer's base disagrees with ours, \
                     so the tree must be resynchronised rather than patched"
                ),
            ));
        }
        // Iterative descent: a hostile delta must not be able to blow the stack.
        let mut pending = vec![id.to_owned()];
        while let Some(current) = pending.pop() {
            if by_id.remove(&current).is_none() {
                continue;
            }
            if let Some(children) = children_of.get(&current) {
                pending.extend(children.iter().cloned());
            }
        }
    }

    for node in delta
        .get("changed")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let id = node
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if !by_id.contains_key(&id) {
            order.push(id.clone());
        }
        by_id.insert(id, node.clone());
    }

    let root_ids: Vec<Value> = match delta.get("rootIds").and_then(Value::as_array) {
        Some(explicit) => explicit.clone(),
        None => base
            .get("rootIds")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .iter()
            .filter(|raw| by_id.contains_key(raw.as_str().unwrap_or_default()))
            .cloned()
            .collect(),
    };

    let mut nodes: Vec<Value> = Vec::with_capacity(by_id.len());
    let mut seen: HashSet<&str> = HashSet::new();
    for id in &order {
        if !seen.insert(id.as_str()) {
            continue;
        }
        if let Some(node) = by_id.get(id) {
            nodes.push(node.clone());
        }
    }

    let mut composed = serde_json::Map::new();
    composed.insert("v".into(), Value::from(1));
    composed.insert(
        "sessionId".into(),
        base.get("sessionId").cloned().unwrap_or(Value::Null),
    );
    composed.insert(
        "revision".into(),
        delta.get("revision").cloned().unwrap_or(Value::Null),
    );
    composed.insert(
        "columns".into(),
        base.get("columns").cloned().unwrap_or(Value::Null),
    );
    composed.insert(
        "rows".into(),
        base.get("rows").cloned().unwrap_or(Value::Null),
    );
    // Absent cursor means unchanged, so the base's carries over.
    if let Some(cursor) = delta.get("cursor").or_else(|| base.get("cursor")) {
        composed.insert("cursor".into(), cursor.clone());
    }
    composed.insert("rootIds".into(), Value::Array(root_ids));
    composed.insert("nodes".into(), Value::Array(nodes));

    let composed = Value::Object(composed);
    validate_snapshot(&composed, limits)?;
    Ok(composed)
}
