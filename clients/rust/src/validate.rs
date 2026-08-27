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
        } else if has("bounds")
            || has("rect")
            || has("regionBounds")
            || has("paintedRegion")
            || has("paintedRegions")
        {
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

const STATE_BOOL_KEYS: [&str; 12] = [
    "disabled",
    "focused",
    "selected",
    "expanded",
    "modal",
    "busy",
    "hidden",
    "offscreen",
    "readonly",
    "multiline",
    "required",
    "multiselectable",
];

/// Every field a `state` object may carry, as this client knows them.
pub const STATE_KEYS: [&str; 17] = [
    "disabled",
    "focused",
    "selected",
    "expanded",
    "modal",
    "busy",
    "hidden",
    "offscreen",
    "readonly",
    "multiline",
    "required",
    "multiselectable",
    "checked",
    "orientation",
    "level",
    "positionInSet",
    "setSize",
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
    for key in ["setSize"] {
        if object.contains_key(key) {
            non_negative(object.get(key), path(at, &[key]))?;
        }
    }
    Ok(())
}

/// Every field a node may carry, as this client knows them.
pub const NODE_KEYS: [&str; 21] = [
    "id",
    "parentId",
    "role",
    "name",
    "description",
    "value",
    "geometry",
    "state",
    "extended",
    "actions",
    "inputRecipes",
    "labelledBy",
    "describedBy",
    "textRanges",
    "testId",
    "frameworkType",
    "opaqueChildren",
    "p",
    "px",
    "scroll",
    "paintedRegion",
];

fn check_painted_region(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    let region = as_object(value, at)?;
    strict(region, &["regionBounds", "spans"], at)?;
    let bounds = check_rect(
        region.get("regionBounds").unwrap_or(&Value::Null),
        &path(at, &["regionBounds"]),
    )?;
    let spans = region
        .get("spans")
        .and_then(Value::as_array)
        .ok_or_else(|| Issue::new(path(at, &["spans"]), "expected an array"))?;
    if spans.len() > limits.max_nodes {
        return Err(Issue::too_big(
            path(at, &["spans"]),
            "too many region spans",
        ));
    }
    let mut previous: Option<(i64, i64)> = None;
    for (index, raw_span) in spans.iter().enumerate() {
        let span_path = path(at, &["spans", &index.to_string()]);
        let span = as_object(raw_span, &span_path)?;
        strict(span, &["row", "from", "to"], &span_path)?;
        let row = non_negative(span.get("row"), path(&span_path, &["row"]))?;
        let from = non_negative(span.get("from"), path(&span_path, &["from"]))?;
        let to = positive(span.get("to"), path(&span_path, &["to"]))?;
        if to <= from {
            return Err(Issue::new(span_path, "region span must be non-empty"));
        }
        if previous.is_some_and(|(previous_row, previous_to)| {
            row < previous_row || (row == previous_row && from < previous_to)
        }) {
            return Err(Issue::new(
                span_path,
                "region spans must be non-overlapping row-major runs",
            ));
        }
        if row < bounds.row
            || row >= bounds.row + bounds.height
            || from < bounds.column
            || to > bounds.column + bounds.width
        {
            return Err(Issue::new(
                span_path,
                "region span lies outside regionBounds",
            ));
        }
        previous = Some((row, to));
    }
    Ok(())
}
fn check_evidence(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    let evidence = as_object(value, at)?;
    strict(
        evidence,
        &["source", "method", "strength", "providerId"],
        at,
    )?;
    let source = text(evidence.get("source"), path(at, &["source"]), limits)?;
    if ![
        "framework",
        "application",
        "terminal",
        "recognizer",
        "driver",
    ]
    .contains(&source)
    {
        return Err(Issue::new(path(at, &["source"]), "invalid evidence source"));
    }
    let method = text(evidence.get("method"), path(at, &["method"]), limits)?;
    if ![
        "native",
        "instrumented",
        "declared",
        "correlated",
        "measured",
        "derived",
        "heuristic",
    ]
    .contains(&method)
    {
        return Err(Issue::new(path(at, &["method"]), "invalid evidence method"));
    }
    let strength = text(evidence.get("strength"), path(at, &["strength"]), limits)?;
    if !["authoritative", "diagnostic"].contains(&strength) {
        return Err(Issue::new(
            path(at, &["strength"]),
            "invalid evidence strength",
        ));
    }
    if text(
        evidence.get("providerId"),
        path(at, &["providerId"]),
        limits,
    )?
    .is_empty()
    {
        return Err(Issue::new(
            path(at, &["providerId"]),
            "providerId must not be empty",
        ));
    }
    Ok(())
}

fn check_observation<F>(
    value: &Value,
    at: &[String],
    limits: &Limits,
    known: F,
) -> Result<(), Issue>
where
    F: Fn(&Value, &[String]) -> Result<(), Issue>,
{
    let object = as_object(value, at)?;
    match object.get("status").and_then(Value::as_str) {
        Some("known") => {
            strict(object, &["status", "value", "evidence"], at)?;
            let evidence_path = path(at, &["evidence"]);
            check_evidence(
                object.get("evidence").unwrap_or(&Value::Null),
                &evidence_path,
                limits,
            )?;
            known(
                object.get("value").unwrap_or(&Value::Null),
                &path(at, &["value"]),
            )
        }
        Some("absent") => {
            strict(object, &["status", "reason", "evidence"], at)?;
            let reason = text(object.get("reason"), path(at, &["reason"]), limits)?;
            if !["detached", "not-displayed", "not-laid-out"].contains(&reason) {
                return Err(Issue::new(path(at, &["reason"]), "invalid absent reason"));
            }
            let evidence_path = path(at, &["evidence"]);
            check_evidence(
                object.get("evidence").unwrap_or(&Value::Null),
                &evidence_path,
                limits,
            )?;
            if object
                .get("evidence")
                .and_then(Value::as_object)
                .and_then(|value| value.get("strength"))
                .and_then(Value::as_str)
                != Some("authoritative")
            {
                return Err(Issue::new(
                    path(&evidence_path, &["strength"]),
                    "absent observation requires authoritative evidence",
                ));
            }
            Ok(())
        }
        Some("unknown") => {
            strict(object, &["status", "reason"], at)?;
            let reason = text(object.get("reason"), path(at, &["reason"]), limits)?;
            if ![
                "awaiting-revision-pair",
                "provider-refresh",
                "stale-revision",
            ]
            .contains(&reason)
            {
                return Err(Issue::new(path(at, &["reason"]), "invalid unknown reason"));
            }
            Ok(())
        }
        Some("unsupported") => {
            strict(object, &["status", "capability", "reason"], at)?;
            text(object.get("capability"), path(at, &["capability"]), limits)?;
            text(object.get("reason"), path(at, &["reason"]), limits)?;
            Ok(())
        }
        _ => Err(Issue::new(
            path(at, &["status"]),
            "invalid observation status",
        )),
    }
}

fn check_semantic_value(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    let object = as_object(value, at)?;
    let check_sensitivity = || -> Result<(), Issue> {
        let sensitivity = text(
            object.get("sensitivity"),
            path(at, &["sensitivity"]),
            limits,
        )?;
        if !["public", "sensitive"].contains(&sensitivity) {
            return Err(Issue::new(
                path(at, &["sensitivity"]),
                "invalid semantic value sensitivity",
            ));
        }
        Ok(())
    };
    match object.get("status").and_then(Value::as_str) {
        Some("known") => {
            strict(object, &["status", "value", "sensitivity", "evidence"], at)?;
            text(object.get("value"), path(at, &["value"]), limits)?;
            check_sensitivity()?;
            check_evidence(
                object.get("evidence").unwrap_or(&Value::Null),
                &path(at, &["evidence"]),
                limits,
            )
        }
        Some("absent") => {
            strict(object, &["status", "reason", "evidence"], at)?;
            let reason = text(object.get("reason"), path(at, &["reason"]), limits)?;
            if !["detached", "not-displayed", "not-laid-out", "no-value"].contains(&reason) {
                return Err(Issue::new(
                    path(at, &["reason"]),
                    "invalid semantic value absent reason",
                ));
            }
            let evidence_path = path(at, &["evidence"]);
            check_evidence(
                object.get("evidence").unwrap_or(&Value::Null),
                &evidence_path,
                limits,
            )?;
            if object
                .get("evidence")
                .and_then(Value::as_object)
                .and_then(|v| v.get("strength"))
                .and_then(Value::as_str)
                != Some("authoritative")
            {
                return Err(Issue::new(
                    path(&evidence_path, &["strength"]),
                    "absent semantic value requires authoritative evidence",
                ));
            }
            Ok(())
        }
        Some("unknown") => {
            strict(object, &["status", "reason"], at)?;
            let reason = text(object.get("reason"), path(at, &["reason"]), limits)?;
            if ![
                "awaiting-revision-pair",
                "provider-refresh",
                "stale-revision",
            ]
            .contains(&reason)
            {
                return Err(Issue::new(
                    path(at, &["reason"]),
                    "invalid semantic value unknown reason",
                ));
            }
            Ok(())
        }
        Some("unsupported") => {
            strict(object, &["status", "capability", "reason"], at)?;
            if text(object.get("capability"), path(at, &["capability"]), limits)?
                != "semantic-value"
            {
                return Err(Issue::new(
                    path(at, &["capability"]),
                    "expected semantic-value capability",
                ));
            }
            let reason = text(object.get("reason"), path(at, &["reason"]), limits)?;
            if !["capability", "framework-unobservable", "not-negotiated"].contains(&reason) {
                return Err(Issue::new(
                    path(at, &["reason"]),
                    "invalid semantic value unsupported reason",
                ));
            }
            Ok(())
        }
        Some("withheld") => {
            strict(object, &["status", "reason", "sensitivity"], at)?;
            let reason = text(object.get("reason"), path(at, &["reason"]), limits)?;
            if !["sensitive", "artifact-policy", "provider-policy"].contains(&reason) {
                return Err(Issue::new(
                    path(at, &["reason"]),
                    "invalid semantic value withheld reason",
                ));
            }
            check_sensitivity()
        }
        _ => Err(Issue::new(
            path(at, &["status"]),
            "invalid semantic value status",
        )),
    }
}

fn check_extended(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    match value {
        Value::Null | Value::Bool(_) => Ok(()),
        Value::String(_) => {
            text(Some(value), at.to_vec(), limits)?;
            Ok(())
        }
        Value::Number(number) => {
            let valid = number
                .as_f64()
                .is_some_and(|value| value.is_finite() && value.abs() <= MAX_SAFE_INTEGER as f64);
            if valid {
                Ok(())
            } else {
                Err(Issue::new(
                    at.to_vec(),
                    "expected a finite JSON number in the safe range",
                ))
            }
        }
        Value::Array(items) => {
            if items.len() > limits.max_relation_targets {
                return Err(Issue::too_big(
                    at.to_vec(),
                    format!("expected at most {} items", limits.max_relation_targets),
                ));
            }
            for (index, item) in items.iter().enumerate() {
                check_extended(item, &path(at, &[&index.to_string()]), limits)?;
            }
            Ok(())
        }
        Value::Object(fields) => {
            if fields.len() > limits.max_relation_targets {
                return Err(Issue::too_big(
                    at.to_vec(),
                    format!(
                        "expected at most {} properties",
                        limits.max_relation_targets
                    ),
                ));
            }
            for (key, item) in fields {
                text(Some(&Value::String(key.clone())), path(at, &[key]), limits)?;
                check_extended(item, &path(at, &[key]), limits)?;
            }
            Ok(())
        }
    }
}

/// Where a semantic fact came from. Closed set, so an unknown source is a
/// rejection rather than a silently ignored annotation.
const PROVENANCE_SOURCES: [&str; 6] = [
    "annotation",
    "recognizer",
    "framework",
    "application",
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

const PHYSICAL_INPUT_RECIPE_ACTIONS: [&str; 4] = ["focus", "activate", "toggle", "setValue"];

fn check_input_recipes(value: &Value, at: &[String], limits: &Limits) -> Result<(), Issue> {
    let Some(items) = value.as_array() else {
        return Err(Issue::new(at.to_vec(), "expected an array"));
    };
    if items.len() > PHYSICAL_INPUT_RECIPE_ACTIONS.len() {
        return Err(Issue::too_big(at.to_vec(), "too many input recipes"));
    }
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let item_path = path(at, &[&index.to_string()]);
        let recipe = as_object(item, &item_path)?;
        strict(recipe, &["action", "requiresFocus", "steps"], &item_path)?;
        let action = text(recipe.get("action"), path(&item_path, &["action"]), limits)?;
        if !PHYSICAL_INPUT_RECIPE_ACTIONS.contains(&action) {
            return Err(Issue::new(
                path(&item_path, &["action"]),
                "expected a physical input recipe action",
            ));
        }
        if !seen.insert(action) {
            return Err(Issue::new(
                path(&item_path, &["action"]),
                "input recipe actions must be unique",
            ));
        }
        let requires_focus = boolean(
            recipe.get("requiresFocus"),
            path(&item_path, &["requiresFocus"]),
        )?;
        if action == "focus" && requires_focus {
            return Err(Issue::new(
                path(&item_path, &["requiresFocus"]),
                "focus recipe cannot require focus",
            ));
        }
        let steps_path = path(&item_path, &["steps"]);
        let Some(steps) = recipe.get("steps").and_then(Value::as_array) else {
            return Err(Issue::new(steps_path, "expected an array"));
        };
        if steps.is_empty() {
            return Err(Issue::new(steps_path, "expected at least one step"));
        }
        if steps.len() > limits.max_relation_targets {
            return Err(Issue::too_big(steps_path, "too many recipe steps"));
        }
        let mut insert_count = 0;
        for (step_index, raw_step) in steps.iter().enumerate() {
            let step_path = path(&item_path, &["steps", &step_index.to_string()]);
            let step = as_object(raw_step, &step_path)?;
            let kind = text(step.get("kind"), path(&step_path, &["kind"]), limits)?;
            match kind {
                "press" => {
                    strict(step, &["kind", "key"], &step_path)?;
                    let key = text(step.get("key"), path(&step_path, &["key"]), limits)?;
                    if key.is_empty() {
                        return Err(Issue::new(
                            path(&step_path, &["key"]),
                            "key must not be empty",
                        ));
                    }
                }
                "insert-action-value" => {
                    strict(step, &["kind"], &step_path)?;
                    insert_count += 1;
                }
                _ => {
                    return Err(Issue::new(
                        path(&step_path, &["kind"]),
                        "expected a physical input recipe step",
                    ));
                }
            }
        }
        if (action == "setValue" && insert_count != 1)
            || (action != "setValue" && insert_count != 0)
        {
            return Err(Issue::new(
                path(&item_path, &["steps"]),
                "setValue requires exactly one insert-action-value step",
            ));
        }
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
                "expected one of the semantic roles",
            ))
        }
    }
    text(object.get("name"), path(at, &["name"]), limits)?;
    for key in ["description", "testId", "frameworkType"] {
        if object.contains_key(key) {
            text(object.get(key), path(at, &[key]), limits)?;
        }
    }
    if object
        .get("opaqueChildren")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(Issue::new(
            path(at, &["opaqueChildren"]),
            "expected boolean",
        ));
    }
    if let Some(value) = object.get("value") {
        check_semantic_value(value, &path(at, &["value"]), limits)?;
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
    let geometry_path = path(at, &["geometry"]);
    let geometry = as_object(
        object.get("geometry").unwrap_or(&Value::Null),
        &geometry_path,
    )?;
    strict(
        geometry,
        &["displayed", "intendedRect", "visibleRect"],
        &geometry_path,
    )?;
    check_observation(
        geometry.get("displayed").unwrap_or(&Value::Null),
        &path(&geometry_path, &["displayed"]),
        limits,
        |value, at| boolean(Some(value), at.to_vec()).map(|_| ()),
    )?;
    for field in ["intendedRect", "visibleRect"] {
        check_observation(
            geometry.get(field).unwrap_or(&Value::Null),
            &path(&geometry_path, &[field]),
            limits,
            |value, at| check_rect(value, at).map(|_| ()),
        )?;
    }
    if let Some(scroll) = object.get("scroll") {
        check_observation(
            scroll,
            &path(at, &["scroll"]),
            limits,
            |value, scroll_path| {
                let state = as_object(value, scroll_path)?;
                strict(
                    state,
                    &["axis", "offset", "viewport", "extent"],
                    scroll_path,
                )?;
                if !matches!(
                    state.get("axis").and_then(Value::as_str),
                    Some("vertical") | Some("horizontal")
                ) {
                    return Err(Issue::new(
                        path(scroll_path, &["axis"]),
                        "invalid scroll axis",
                    ));
                }
                let offset = non_negative(state.get("offset"), path(scroll_path, &["offset"]))?;
                let viewport =
                    non_negative(state.get("viewport"), path(scroll_path, &["viewport"]))?;
                let extent = non_negative(state.get("extent"), path(scroll_path, &["extent"]))?;
                if offset + viewport > extent {
                    return Err(Issue::new(
                        scroll_path.to_vec(),
                        "scroll state must fit inside its extent",
                    ));
                }
                Ok(())
            },
        )?;
    }
    if let Some(painted_region) = object.get("paintedRegion") {
        check_observation(
            painted_region,
            &path(at, &["paintedRegion"]),
            limits,
            |value, painted_path| check_painted_region(value, painted_path, limits),
        )?;
    }
    if let Some(state) = object.get("state") {
        check_state(state, &path(at, &["state"]))?;
        // Every cell outside the visible area and the node still visible
        // cannot both be true. Refusing the pair keeps `offscreen` a claim
        // about scrolling rather than a second, weaker way of saying hidden.
        let offscreen = state.get("offscreen").and_then(Value::as_bool) == Some(true);
        let hidden = state.get("hidden").and_then(Value::as_bool) == Some(true);
        if offscreen && !hidden {
            let id = object.get("id").and_then(Value::as_str).unwrap_or("");
            return Err(Issue::new(
                path(at, &["state", "offscreen"]),
                format!(
                    "node {id}: state.offscreen implies state.hidden — every cell is outside \
                     the visible area, so the node cannot also be visible"
                ),
            ));
        }
    }
    if let Some(extended) = object.get("extended") {
        if !extended.is_object() {
            return Err(Issue::new(path(at, &["extended"]), "expected an object"));
        }
        check_extended(extended, &path(at, &["extended"]), limits)?;
    }
    let mut declared_actions = HashSet::new();
    if let Some(actions) = object.get("actions") {
        let Some(items) = actions.as_array() else {
            return Err(Issue::new(path(at, &["actions"]), "expected an array"));
        };
        if items.len() > crate::roles::SEMANTIC_ACTIONS.len() {
            return Err(Issue::too_big(path(at, &["actions"]), "too many actions"));
        }
        for (index, item) in items.iter().enumerate() {
            match item.as_str() {
                Some(action) if valid_action(action) => {
                    declared_actions.insert(action);
                }
                _ => {
                    return Err(Issue::new(
                        path(at, &["actions", &index.to_string()]),
                        "expected one of the semantic actions",
                    ))
                }
            }
        }
    }
    if let Some(recipes) = object.get("inputRecipes") {
        check_input_recipes(recipes, &path(at, &["inputRecipes"]), limits)?;
        for (index, recipe) in recipes
            .as_array()
            .expect("validated recipe array")
            .iter()
            .enumerate()
        {
            let action = recipe
                .get("action")
                .and_then(Value::as_str)
                .expect("validated recipe action");
            if !declared_actions.contains(action) {
                return Err(Issue::new(
                    path(at, &["inputRecipes", &index.to_string(), "action"]),
                    format!("input recipe {action:?} requires the matching semantic action intent"),
                ));
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

const SNAPSHOT_KEYS: [&str; 11] = [
    "v",
    "sessionId",
    "revision",
    "columns",
    "rows",
    "cursor",
    "rootIds",
    "nodes",
    "coordinateSpace",
    "hitGrid",
    "providerEvidence",
];

fn check_snapshot_schema(value: &Value, limits: &Limits) -> Result<(), Issue> {
    let root: Vec<String> = Vec::new();
    let object = as_object(value, &root)?;
    let version = object.get("v").and_then(Value::as_i64);
    strict(object, &SNAPSHOT_KEYS, &root)?;

    if version != Some(2) {
        return Err(Issue::new(vec!["v".into()], "expected the literal 2"));
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
    check_observation(
        object.get("coordinateSpace").unwrap_or(&Value::Null),
        &["coordinateSpace".into()],
        limits,
        |value, at| {
            if matches!(
                value.as_str(),
                Some("viewport-cells") | Some("framework-local-cells")
            ) {
                Ok(())
            } else {
                Err(Issue::new(at.to_vec(), "invalid coordinate space"))
            }
        },
    )?;
    if let Some(provider_evidence) = object.get("providerEvidence") {
        let entries = provider_evidence
            .as_array()
            .ok_or_else(|| Issue::new(vec!["providerEvidence".into()], "expected an array"))?;
        if entries.len() > 64 {
            return Err(Issue::too_big(
                vec!["providerEvidence".into()],
                "expected at most 64 items",
            ));
        }
        for (index, raw) in entries.iter().enumerate() {
            let entry_path = vec!["providerEvidence".into(), index.to_string()];
            let entry = as_object(raw, &entry_path)?;
            let status = entry.get("status").and_then(Value::as_str);
            match status {
                Some("available") => {
                    strict(
                        entry,
                        &[
                            "providerId",
                            "sessionId",
                            "revision",
                            "status",
                            "evidence",
                            "pointerRegions",
                            "paintedRegions",
                            "inputModes",
                            "focusState",
                            "actionRecipes",
                            "scrollStates",
                            "hitGrid",
                        ],
                        &entry_path,
                    )?;
                    check_evidence(
                        entry.get("evidence").unwrap_or(&Value::Null),
                        &path(&entry_path, &["evidence"]),
                        limits,
                    )?;
                    let regions = entry
                        .get("pointerRegions")
                        .and_then(Value::as_array)
                        .ok_or_else(|| {
                            Issue::new(path(&entry_path, &["pointerRegions"]), "expected an array")
                        })?;
                    if regions.len() > limits.max_nodes {
                        return Err(Issue::too_big(
                            path(&entry_path, &["pointerRegions"]),
                            "too many pointer regions",
                        ));
                    }
                    for (region_index, raw_region) in regions.iter().enumerate() {
                        let region_path =
                            path(&entry_path, &["pointerRegions", &region_index.to_string()]);
                        let region = as_object(raw_region, &region_path)?;
                        strict(
                            region,
                            &["recipientId", "regionBounds", "spans"],
                            &region_path,
                        )?;
                        if text(
                            region.get("recipientId"),
                            path(&region_path, &["recipientId"]),
                            limits,
                        )?
                        .is_empty()
                        {
                            return Err(Issue::new(
                                path(&region_path, &["recipientId"]),
                                "recipient id must not be empty",
                            ));
                        }
                        let projected = serde_json::json!({
                            "regionBounds": region.get("regionBounds"),
                            "spans": region.get("spans"),
                        });
                        check_painted_region(&projected, &region_path, limits)?;
                    }
                    if let Some(painted_regions) = entry.get("paintedRegions") {
                        let regions = painted_regions.as_array().ok_or_else(|| {
                            Issue::new(path(&entry_path, &["paintedRegions"]), "expected an array")
                        })?;
                        if regions.len() > limits.max_nodes {
                            return Err(Issue::too_big(
                                path(&entry_path, &["paintedRegions"]),
                                "too many painted regions",
                            ));
                        }
                        let mut recipients = HashSet::new();
                        for (region_index, raw_region) in regions.iter().enumerate() {
                            let region_path =
                                path(&entry_path, &["paintedRegions", &region_index.to_string()]);
                            let region = as_object(raw_region, &region_path)?;
                            strict(
                                region,
                                &["recipientId", "regionBounds", "spans"],
                                &region_path,
                            )?;
                            let recipient = text(
                                region.get("recipientId"),
                                path(&region_path, &["recipientId"]),
                                limits,
                            )?;
                            if recipient.is_empty() || !recipients.insert(recipient) {
                                return Err(Issue::new(
                                    path(&region_path, &["recipientId"]),
                                    "painted region recipients must be non-empty and unique",
                                ));
                            }
                            let projected = serde_json::json!({
                                "regionBounds": region.get("regionBounds"),
                                "spans": region.get("spans"),
                            });
                            check_painted_region(&projected, &region_path, limits)?;
                        }
                    }
                    if let Some(raw_modes) = entry.get("inputModes") {
                        let modes_path = path(&entry_path, &["inputModes"]);
                        let modes = as_object(raw_modes, &modes_path)?;
                        strict(
                            modes,
                            &["mouseTracking", "mouseEncoding", "focusReporting"],
                            &modes_path,
                        )?;
                        if !matches!(
                            modes.get("mouseTracking").and_then(Value::as_str),
                            Some("none" | "x10" | "vt200" | "drag" | "any")
                        ) {
                            return Err(Issue::new(
                                path(&modes_path, &["mouseTracking"]),
                                "invalid mouse tracking mode",
                            ));
                        }
                        if !matches!(
                            modes.get("mouseEncoding").and_then(Value::as_str),
                            Some("default" | "sgr" | "urxvt" | "utf8")
                        ) {
                            return Err(Issue::new(
                                path(&modes_path, &["mouseEncoding"]),
                                "invalid mouse encoding",
                            ));
                        }
                        if !matches!(
                            modes.get("focusReporting").and_then(Value::as_str),
                            Some("on" | "off")
                        ) {
                            return Err(Issue::new(
                                path(&modes_path, &["focusReporting"]),
                                "invalid focus reporting mode",
                            ));
                        }
                    }
                    if let Some(raw_focus) = entry.get("focusState") {
                        let focus_path = path(&entry_path, &["focusState"]);
                        let focus = as_object(raw_focus, &focus_path)?;
                        match focus.get("status").and_then(Value::as_str) {
                            Some("focused") => {
                                strict(focus, &["status", "recipientId"], &focus_path)?;
                                if text(
                                    focus.get("recipientId"),
                                    path(&focus_path, &["recipientId"]),
                                    limits,
                                )?
                                .is_empty()
                                {
                                    return Err(Issue::new(
                                        path(&focus_path, &["recipientId"]),
                                        "recipient id must not be empty",
                                    ));
                                }
                            }
                            Some("none") => strict(focus, &["status"], &focus_path)?,
                            _ => {
                                return Err(Issue::new(
                                    path(&focus_path, &["status"]),
                                    "expected focused or none",
                                ))
                            }
                        }
                    }
                    if let Some(action_recipes) = entry.get("actionRecipes") {
                        let targets = action_recipes.as_array().ok_or_else(|| {
                            Issue::new(path(&entry_path, &["actionRecipes"]), "expected an array")
                        })?;
                        if targets.len() > limits.max_nodes {
                            return Err(Issue::too_big(
                                path(&entry_path, &["actionRecipes"]),
                                "too many action recipe recipients",
                            ));
                        }
                        let mut recipients = HashSet::new();
                        for (target_index, raw_target) in targets.iter().enumerate() {
                            let target_path =
                                path(&entry_path, &["actionRecipes", &target_index.to_string()]);
                            let target = as_object(raw_target, &target_path)?;
                            strict(target, &["recipientId", "recipes"], &target_path)?;
                            let recipient = text(
                                target.get("recipientId"),
                                path(&target_path, &["recipientId"]),
                                limits,
                            )?;
                            if recipient.is_empty() {
                                return Err(Issue::new(
                                    path(&target_path, &["recipientId"]),
                                    "recipient id must not be empty",
                                ));
                            }
                            if !recipients.insert(recipient) {
                                return Err(Issue::new(
                                    path(&target_path, &["recipientId"]),
                                    "provider action recipe recipients must be unique",
                                ));
                            }
                            check_input_recipes(
                                target.get("recipes").unwrap_or(&Value::Null),
                                &path(&target_path, &["recipes"]),
                                limits,
                            )?;
                        }
                    }
                    if let Some(scroll_states) = entry.get("scrollStates") {
                        let states = scroll_states.as_array().ok_or_else(|| {
                            Issue::new(path(&entry_path, &["scrollStates"]), "expected an array")
                        })?;
                        if states.len() > limits.max_nodes {
                            return Err(Issue::too_big(
                                path(&entry_path, &["scrollStates"]),
                                "too many scroll recipients",
                            ));
                        }
                        let mut recipients = HashSet::new();
                        for (state_index, raw_state) in states.iter().enumerate() {
                            let state_path =
                                path(&entry_path, &["scrollStates", &state_index.to_string()]);
                            let state = as_object(raw_state, &state_path)?;
                            strict(
                                state,
                                &["recipientId", "axis", "offset", "viewport", "extent"],
                                &state_path,
                            )?;
                            let recipient = text(
                                state.get("recipientId"),
                                path(&state_path, &["recipientId"]),
                                limits,
                            )?;
                            if recipient.is_empty() || !recipients.insert(recipient) {
                                return Err(Issue::new(
                                    path(&state_path, &["recipientId"]),
                                    "scroll recipients must be non-empty and unique",
                                ));
                            }
                            if !matches!(
                                state.get("axis").and_then(Value::as_str),
                                Some("vertical") | Some("horizontal")
                            ) {
                                return Err(Issue::new(
                                    path(&state_path, &["axis"]),
                                    "invalid scroll axis",
                                ));
                            }
                            let offset =
                                non_negative(state.get("offset"), path(&state_path, &["offset"]))?;
                            let viewport = non_negative(
                                state.get("viewport"),
                                path(&state_path, &["viewport"]),
                            )?;
                            let extent =
                                non_negative(state.get("extent"), path(&state_path, &["extent"]))?;
                            if offset + viewport > extent {
                                return Err(Issue::new(
                                    state_path,
                                    "scroll state must fit inside its extent",
                                ));
                            }
                        }
                    }
                }
                Some("lost") | Some("violation") => {
                    strict(
                        entry,
                        &["providerId", "sessionId", "revision", "status", "reason"],
                        &entry_path,
                    )?;
                    let reason = text(entry.get("reason"), path(&entry_path, &["reason"]), limits)?;
                    if reason.is_empty() {
                        return Err(Issue::new(
                            path(&entry_path, &["reason"]),
                            "provider reason must not be empty",
                        ));
                    }
                }
                _ => {
                    return Err(Issue::new(
                        path(&entry_path, &["status"]),
                        "expected available, lost, or violation",
                    ));
                }
            }
            for key in ["providerId", "sessionId"] {
                let value = text(entry.get(key), path(&entry_path, &[key]), limits)?;
                if value.is_empty() {
                    return Err(Issue::new(
                        path(&entry_path, &[key]),
                        "provider identity must not be empty",
                    ));
                }
            }
            positive(entry.get("revision"), path(&entry_path, &["revision"]))?;
        }
    }
    check_observation(
        object.get("hitGrid").unwrap_or(&Value::Null),
        &["hitGrid".into()],
        limits,
        |value, at| {
            let grid = as_object(value, at)?;
            strict(grid, &["regions"], at)?;
            let regions = grid
                .get("regions")
                .and_then(Value::as_array)
                .ok_or_else(|| Issue::new(path(at, &["regions"]), "expected an array"))?;
            if regions.len() > limits.max_nodes {
                return Err(Issue::too_big(
                    path(at, &["regions"]),
                    "too many hit regions",
                ));
            }
            let mut previous: Option<Rect> = None;
            for (index, raw) in regions.iter().enumerate() {
                let rp = path(at, &["regions", &index.to_string()]);
                let region = as_object(raw, &rp)?;
                strict(region, &["rect", "recipientId"], &rp)?;
                let rect = check_rect(
                    region.get("rect").unwrap_or(&Value::Null),
                    &path(&rp, &["rect"]),
                )?;
                if rect.width <= 0 || rect.height != 1 {
                    return Err(Issue::new(
                        path(&rp, &["rect"]),
                        "hit regions must be non-empty row runs",
                    ));
                }
                if previous.as_ref().is_some_and(|last| {
                    rect.row < last.row
                        || (rect.row == last.row && rect.column < last.column + last.width)
                }) {
                    return Err(Issue::new(
                        path(&rp, &["rect"]),
                        "hit regions must be non-overlapping row-major runs",
                    ));
                }
                previous = Some(rect);
                text(
                    region.get("recipientId"),
                    path(&rp, &["recipientId"]),
                    limits,
                )?;
            }
            Ok(())
        },
    )?;
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

    if let Some(painted) = node.get("paintedRegion").and_then(Value::as_object) {
        if painted.get("status").and_then(Value::as_str) == Some("known") {
            let spans = painted["value"]["spans"]
                .as_array()
                .expect("painted region schema checked");
            for span in spans {
                let row = span["row"].as_i64().unwrap_or_default();
                let from = span["from"].as_i64().unwrap_or_default();
                let to = span["to"].as_i64().unwrap_or_default();
                if row >= rows || from >= columns || to > columns {
                    return Err(ValidationError::new(
                        "bad-rect",
                        format!("node {id} painted region span lies outside the viewport"),
                    ));
                }
            }
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

    if snapshot["v"].as_i64() == Some(2) {
        let hit_grid = snapshot["hitGrid"]
            .as_object()
            .expect("checked by the schema layer");
        if hit_grid.get("status").and_then(Value::as_str) == Some("known") {
            for raw in hit_grid["value"]["regions"]
                .as_array()
                .expect("checked by the schema layer")
            {
                let region = raw.as_object().expect("checked by the schema layer");
                let recipient_id = region["recipientId"].as_str().unwrap_or_default();
                if !ids.contains(recipient_id) {
                    return Err(ValidationError::new(
                        "missing-parent",
                        format!("hitGrid references unknown recipient {recipient_id}"),
                    ));
                }
                let rect = check_rect(&region["rect"], &[]).map_err(Issue::into_error)?;
                if !intersects_viewport(&rect, columns, rows) {
                    return Err(ValidationError::new(
                        "bad-rect",
                        format!(
                            "hitGrid region for {recipient_id} does not intersect the viewport"
                        ),
                    ));
                }
            }
        }
    }

    if let Some(provider_evidence) = snapshot.get("providerEvidence").and_then(Value::as_array) {
        let mut provider_ids = HashSet::new();
        for raw in provider_evidence {
            let entry = raw.as_object().expect("provider evidence schema checked");
            let provider_id = entry["providerId"].as_str().unwrap_or_default();
            if !provider_ids.insert(provider_id) {
                return Err(ValidationError::new(
                    "provider",
                    format!("provider evidence id {provider_id} appears more than once"),
                ));
            }
            if entry["sessionId"] != snapshot["sessionId"]
                || entry["revision"] != snapshot["revision"]
            {
                return Err(ValidationError::new(
                    "provider",
                    format!("provider {provider_id} evidence does not match snapshot revision"),
                ));
            }
            if entry.get("status").and_then(Value::as_str) != Some("available") {
                continue;
            }
            if let Some(focus) = entry.get("focusState").and_then(Value::as_object) {
                if focus.get("status").and_then(Value::as_str) == Some("focused") {
                    let recipient = focus
                        .get("recipientId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !by_id.contains_key(recipient) {
                        return Err(ValidationError::new(
                            "missing-parent",
                            format!("provider {provider_id} focus references unknown recipient {recipient}"),
                        ));
                    }
                }
            }
            for target in entry
                .get("actionRecipes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let target = target
                    .as_object()
                    .expect("action recipe target schema checked");
                let recipient = target["recipientId"].as_str().unwrap_or_default();
                let Some(node) = by_id.get(recipient) else {
                    return Err(ValidationError::new(
                        "missing-parent",
                        format!(
                            "provider {provider_id} action recipes reference unknown recipient {recipient}"
                        ),
                    ));
                };
                let intents: HashSet<&str> = node
                    .get("actions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                for recipe in target["recipes"].as_array().expect("recipe schema checked") {
                    let action = recipe["action"].as_str().unwrap_or_default();
                    if !intents.contains(action) {
                        return Err(ValidationError::new(
                            "provider",
                            format!(
                                "provider {provider_id} {action} recipe has no matching semantic action intent on {recipient}"
                            ),
                        ));
                    }
                }
            }
            for state in entry
                .get("scrollStates")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let state = state.as_object().expect("scroll state schema checked");
                let recipient = state["recipientId"].as_str().unwrap_or_default();
                if !by_id.contains_key(recipient) {
                    return Err(ValidationError::new(
                        "missing-parent",
                        format!("provider {provider_id} scroll state references unknown recipient {recipient}"),
                    ));
                }
            }
            for region in entry
                .get("paintedRegions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let region = region.as_object().expect("painted region schema checked");
                let recipient = region["recipientId"].as_str().unwrap_or_default();
                if !by_id.contains_key(recipient) {
                    return Err(ValidationError::new(
                        "missing-parent",
                        format!("provider {provider_id} painted region references unknown recipient {recipient}"),
                    ));
                }
                for span in region["spans"]
                    .as_array()
                    .expect("painted region schema checked")
                {
                    let row = span["row"].as_i64().unwrap_or_default();
                    let from = span["from"].as_i64().unwrap_or_default();
                    let to = span["to"].as_i64().unwrap_or_default();
                    if row >= rows || from >= columns || to > columns {
                        return Err(ValidationError::new(
                            "bad-rect",
                            format!("provider {provider_id} painted region for {recipient} lies outside the viewport"),
                        ));
                    }
                }
            }
        }
    }

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
