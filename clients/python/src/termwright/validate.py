"""Snapshot validation.

A structural port of ``validate.ts``: same invariants, same error codes, same
order of checks, so a snapshot rejected here is rejected by the driver and vice
versa. Never raises on hostile input — failures come back as a result object.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from .errors import ProtocolViolation
from .framing import encode_json, project_dto
from .limits import DEFAULT_LIMITS, ProtocolLimits
from .roles import ACTION_SET, ROLE_SET

VALIDATION_ERROR_CODES = (
    "schema",
    "unknown-role",
    "duplicate-id",
    "missing-parent",
    "cycle",
    "depth",
    "count",
    "string-bytes",
    "bad-rect",
    "revision",
    "bytes",
)

_MAX_SAFE_INTEGER = 2**53 - 1


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of :func:`validate_snapshot`."""

    ok: bool
    snapshot: Optional[Dict[str, Any]] = None
    code: Optional[str] = None
    detail: str = ""


def _fail(code: str, detail: str) -> ValidationResult:
    return ValidationResult(ok=False, code=code, detail=detail)


class _Issue(Exception):
    """A schema-level defect, carrying the path zod would have reported."""

    def __init__(self, path: Sequence[str], message: str, too_big: bool = False) -> None:
        super().__init__(message)
        self.path: Tuple[str, ...] = tuple(path)
        self.message = message
        self.too_big = too_big

    @property
    def code(self) -> str:
        if "role" in self.path:
            return "unknown-role"
        if "revision" in self.path:
            return "revision"
        if any(key in self.path for key in ("rect", "regionBounds", "paintedRegion", "paintedRegions")):
            return "bad-rect"
        if self.too_big and ("nodes" in self.path or "rootIds" in self.path):
            return "count"
        if "UTF-8 bytes" in self.message:
            return "string-bytes"
        return "schema"

    @property
    def detail(self) -> str:
        where = ".".join(self.path) if self.path else "<root>"
        return f"{where}: {self.message}"


# --------------------------------------------------------------------------
# Schema layer — mirrors the zod schema, field for field.
# --------------------------------------------------------------------------


def _obj(value: Any, path: Sequence[str]) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise _Issue(path, "expected an object")
    return value


def _strict(value: Mapping[str, Any], allowed: Sequence[str], path: Sequence[str]) -> None:
    unknown = [key for key in value if key not in allowed]
    if unknown:
        raise _Issue(path, f"Unrecognized key(s) in object: {', '.join(repr(k) for k in unknown)}")


def _safe_int(value: Any, path: Sequence[str]) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or abs(value) > _MAX_SAFE_INTEGER:
        raise _Issue(path, "expected a safe integer")
    return value


def _non_negative_int(value: Any, path: Sequence[str]) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > _MAX_SAFE_INTEGER:
        raise _Issue(path, "expected a non-negative safe integer")
    return value


def _positive_int(value: Any, path: Sequence[str]) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > _MAX_SAFE_INTEGER:
        raise _Issue(path, "expected a positive safe integer")
    return value


def _text(value: Any, path: Sequence[str], limits: ProtocolLimits) -> str:
    if not isinstance(value, str):
        raise _Issue(path, "expected a string")
    if len(value.encode("utf-8", "surrogatepass")) > limits.maxStringBytes:
        raise _Issue(path, f"expected at most {limits.maxStringBytes} UTF-8 bytes")
    return value


def _bool(value: Any, path: Sequence[str]) -> bool:
    if not isinstance(value, bool):
        raise _Issue(path, "expected a boolean")
    return value


def _rect(value: Any, path: Sequence[str]) -> Mapping[str, int]:
    rect = _obj(value, path)
    _strict(rect, ("row", "column", "width", "height"), path)
    for key in ("row", "column"):
        if key not in rect:
            raise _Issue(tuple(path) + (key,), "expected a safe integer")
        _safe_int(rect[key], tuple(path) + (key,))
    for key in ("width", "height"):
        if key not in rect:
            raise _Issue(tuple(path) + (key,), "expected a non-negative safe integer")
        _non_negative_int(rect[key], tuple(path) + (key,))
    return rect


_STATE_BOOLS = (
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
)
_STATE_KEYS = _STATE_BOOLS + (
    "checked",
    "orientation",
    "level",
    "positionInSet",
    "setSize",
)


def _state(value: Any, path: Sequence[str]) -> None:
    state = _obj(value, path)
    _strict(state, _STATE_KEYS, path)
    for key in _STATE_BOOLS:
        if key in state:
            _bool(state[key], tuple(path) + (key,))
    if "checked" in state and not (isinstance(state["checked"], bool) or state["checked"] == "mixed"):
        raise _Issue(tuple(path) + ("checked",), "expected a boolean or 'mixed'")
    if "orientation" in state and state["orientation"] not in ("horizontal", "vertical"):
        raise _Issue(tuple(path) + ("orientation",), "expected 'horizontal' or 'vertical'")
    for key in ("level", "positionInSet"):
        if key in state:
            _positive_int(state[key], tuple(path) + (key,))
    for key in ("setSize",):
        if key in state:
            _non_negative_int(state[key], tuple(path) + (key,))


_NODE_KEYS = (
    "id",
    "parentId",
    "role",
    "name",
    "description",
    "value",
    "state",
    "extended",
    "actions",
    "inputRecipes",
    "labelledBy",
    "describedBy",
    "textRanges",
    "testId",
    "frameworkType",
    "p",
    "px",
    "geometry",
    "scroll",
    "paintedRegion",
)

_EVIDENCE_SOURCES = ("framework", "application", "terminal", "recognizer", "driver")
_EVIDENCE_METHODS = ("native", "instrumented", "declared", "correlated", "measured", "derived", "heuristic")
_EVIDENCE_STRENGTHS = ("authoritative", "diagnostic")


def _evidence(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    item = _obj(value, path)
    _strict(item, ("source", "method", "strength", "providerId"), path)
    if item.get("source") not in _EVIDENCE_SOURCES:
        raise _Issue(tuple(path) + ("source",), "invalid evidence source")
    if item.get("method") not in _EVIDENCE_METHODS:
        raise _Issue(tuple(path) + ("method",), "invalid evidence method")
    if item.get("strength") not in _EVIDENCE_STRENGTHS:
        raise _Issue(tuple(path) + ("strength",), "invalid evidence strength")
    _text(item.get("providerId"), tuple(path) + ("providerId",), limits)


def _observation(value: Any, path: Sequence[str], known, limits: ProtocolLimits) -> None:
    item = _obj(value, path)
    status = item.get("status")
    if status == "known":
        _strict(item, ("status", "value", "evidence"), path)
        if "value" not in item or "evidence" not in item:
            raise _Issue(path, "known observation requires value and evidence")
        _evidence(item["evidence"], tuple(path) + ("evidence",), limits)
        known(item["value"], tuple(path) + ("value",))
    elif status == "absent":
        _strict(item, ("status", "reason", "evidence"), path)
        if item.get("reason") not in ("detached", "not-displayed", "not-laid-out"):
            raise _Issue(tuple(path) + ("reason",), "invalid absent reason")
        if "evidence" not in item:
            raise _Issue(path, "absent observation requires evidence")
        _evidence(item["evidence"], tuple(path) + ("evidence",), limits)
        if item["evidence"].get("strength") != "authoritative":
            raise _Issue(tuple(path) + ("evidence", "strength"), "absent observation requires authoritative evidence")
    elif status == "unknown":
        _strict(item, ("status", "reason"), path)
        if item.get("reason") not in ("awaiting-revision-pair", "provider-refresh", "stale-revision"):
            raise _Issue(tuple(path) + ("reason",), "invalid unknown reason")
    elif status == "unsupported":
        _strict(item, ("status", "capability", "reason"), path)
        _text(item.get("capability"), tuple(path) + ("capability",), limits)
        if item.get("reason") not in ("capability", "framework-unobservable", "not-negotiated"):
            raise _Issue(tuple(path) + ("reason",), "invalid unsupported reason")
    else:
        raise _Issue(tuple(path) + ("status",), "invalid observation status")

#: Where a semantic fact came from. Closed set, so an unknown source is a
#: rejection rather than a silently ignored annotation.
PROVENANCE_SOURCES = (
    "annotation",
    "recognizer",
    "framework",
    "application",
    "correlation",
    "heuristic",
)

def _extended(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        _text(value, path, limits)
        return
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or abs(value) > _MAX_SAFE_INTEGER:
            raise _Issue(path, "expected a finite JSON number in the safe range")
        return
    if isinstance(value, list):
        if len(value) > limits.maxRelationTargets:
            raise _Issue(path, f"expected at most {limits.maxRelationTargets} items", too_big=True)
        for index, item in enumerate(value):
            _extended(item, tuple(path) + (str(index),), limits)
        return
    if isinstance(value, dict):
        if len(value) > limits.maxRelationTargets:
            raise _Issue(path, f"expected at most {limits.maxRelationTargets} properties", too_big=True)
        for key, item in value.items():
            _text(key, tuple(path) + (str(key),), limits)
            _extended(item, tuple(path) + (str(key),), limits)
        return
    raise _Issue(path, "expected JSON scalar, array or object")


def _relations(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    if not isinstance(value, list):
        raise _Issue(path, "expected an array")
    if len(value) > limits.maxRelationTargets:
        raise _Issue(path, f"expected at most {limits.maxRelationTargets} items", too_big=True)
    for index, item in enumerate(value):
        _text(item, tuple(path) + (str(index),), limits)


_PHYSICAL_INPUT_RECIPE_ACTIONS = {"focus", "activate", "toggle", "setValue"}


def _input_recipes(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    if not isinstance(value, list):
        raise _Issue(path, "expected an array")
    if len(value) > len(_PHYSICAL_INPUT_RECIPE_ACTIONS):
        raise _Issue(path, "too many input recipes", too_big=True)
    seen: Set[str] = set()
    for index, raw_recipe in enumerate(value):
        item_path = tuple(path) + (str(index),)
        recipe = _obj(raw_recipe, item_path)
        _strict(recipe, ("action", "requiresFocus", "steps"), item_path)
        action = _text(recipe.get("action"), item_path + ("action",), limits)
        if action not in _PHYSICAL_INPUT_RECIPE_ACTIONS:
            raise _Issue(item_path + ("action",), "expected a physical input recipe action")
        if action in seen:
            raise _Issue(item_path + ("action",), "input recipe actions must be unique")
        seen.add(action)
        requires_focus = _bool(recipe.get("requiresFocus"), item_path + ("requiresFocus",))
        if action == "focus" and requires_focus:
            raise _Issue(item_path + ("requiresFocus",), "focus recipe cannot require focus")
        steps = recipe.get("steps")
        if not isinstance(steps, list):
            raise _Issue(item_path + ("steps",), "expected an array")
        if not steps:
            raise _Issue(item_path + ("steps",), "expected at least one step")
        if len(steps) > limits.maxRelationTargets:
            raise _Issue(item_path + ("steps",), "too many recipe steps", too_big=True)
        insert_count = 0
        for step_index, raw_step in enumerate(steps):
            step_path = item_path + ("steps", str(step_index))
            step = _obj(raw_step, step_path)
            kind = _text(step.get("kind"), step_path + ("kind",), limits)
            if kind == "press":
                _strict(step, ("kind", "key"), step_path)
                key = _text(step.get("key"), step_path + ("key",), limits)
                if not key:
                    raise _Issue(step_path + ("key",), "key must not be empty")
            elif kind == "insert-action-value":
                _strict(step, ("kind",), step_path)
                insert_count += 1
            else:
                raise _Issue(step_path + ("kind",), "expected a physical input recipe step")
        if (action == "setValue" and insert_count != 1) or (
            action != "setValue" and insert_count != 0
        ):
            raise _Issue(
                item_path + ("steps",),
                "setValue requires exactly one insert-action-value step",
            )


def _semantic_value(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    item = _obj(value, path)
    status = item.get("status")
    if status == "known":
        _strict(item, ("status", "value", "sensitivity", "evidence"), path)
        _text(item.get("value"), tuple(path) + ("value",), limits)
        if item.get("sensitivity") not in ("public", "sensitive"):
            raise _Issue(tuple(path) + ("sensitivity",), "expected 'public' or 'sensitive'")
        _evidence(item.get("evidence"), tuple(path) + ("evidence",), limits)
    elif status == "absent":
        _strict(item, ("status", "reason", "evidence"), path)
        if item.get("reason") not in ("detached", "not-displayed", "not-laid-out", "no-value"):
            raise _Issue(tuple(path) + ("reason",), "invalid semantic value absent reason")
        evidence = _obj(item.get("evidence"), tuple(path) + ("evidence",))
        _evidence(evidence, tuple(path) + ("evidence",), limits)
        if evidence.get("strength") != "authoritative":
            raise _Issue(tuple(path) + ("evidence", "strength"), "absent semantic value requires authoritative evidence")
    elif status == "unknown":
        _strict(item, ("status", "reason"), path)
        if item.get("reason") not in ("awaiting-revision-pair", "provider-refresh", "stale-revision"):
            raise _Issue(tuple(path) + ("reason",), "invalid semantic value unknown reason")
    elif status == "unsupported":
        _strict(item, ("status", "capability", "reason"), path)
        if item.get("capability") != "semantic-value":
            raise _Issue(tuple(path) + ("capability",), "expected the literal 'semantic-value'")
        if item.get("reason") not in ("capability", "framework-unobservable", "not-negotiated"):
            raise _Issue(tuple(path) + ("reason",), "invalid semantic value unsupported reason")
    elif status == "withheld":
        _strict(item, ("status", "reason", "sensitivity"), path)
        if item.get("reason") not in ("sensitive", "artifact-policy", "provider-policy"):
            raise _Issue(tuple(path) + ("reason",), "invalid semantic value withheld reason")
        if item.get("sensitivity") not in ("public", "sensitive"):
            raise _Issue(tuple(path) + ("sensitivity",), "expected 'public' or 'sensitive'")
    else:
        raise _Issue(tuple(path) + ("status",), "invalid semantic value status")


def _painted_region(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    region = _obj(value, path)
    _strict(region, ("regionBounds", "spans"), path)
    bounds = _rect(region.get("regionBounds"), tuple(path) + ("regionBounds",))
    spans = region.get("spans")
    if not isinstance(spans, list):
        raise _Issue(tuple(path) + ("spans",), "expected an array")
    if len(spans) > limits.maxNodes:
        raise _Issue(tuple(path) + ("spans",), "too many region spans", too_big=True)
    previous: Optional[Mapping[str, int]] = None
    for index, raw_span in enumerate(spans):
        span_path = tuple(path) + ("spans", str(index))
        span = _obj(raw_span, span_path)
        _strict(span, ("row", "from", "to"), span_path)
        row = _non_negative_int(span.get("row"), span_path + ("row",))
        start = _non_negative_int(span.get("from"), span_path + ("from",))
        end = _positive_int(span.get("to"), span_path + ("to",))
        if end <= start:
            raise _Issue(span_path, "region span must be non-empty")
        if previous is not None and (
            row < previous["row"]
            or (row == previous["row"] and start < previous["to"])
        ):
            raise _Issue(span_path, "region spans must be non-overlapping row-major runs")
        if (
            row < bounds["row"]
            or row >= bounds["row"] + bounds["height"]
            or start < bounds["column"]
            or end > bounds["column"] + bounds["width"]
        ):
            raise _Issue(span_path, "region span lies outside regionBounds")
        previous = {"row": row, "from": start, "to": end}


def _node_schema(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    node = _obj(value, path)
    _strict(node, _NODE_KEYS, path)

    if "id" not in node:
        raise _Issue(tuple(path) + ("id",), "expected a string")
    if _text(node["id"], tuple(path) + ("id",), limits) == "":
        raise _Issue(tuple(path) + ("id",), "node id must not be empty")
    if "parentId" in node:
        _text(node["parentId"], tuple(path) + ("parentId",), limits)
    if node.get("role") not in ROLE_SET:
        raise _Issue(tuple(path) + ("role",), "expected a supported semantic role")
    if "name" not in node:
        raise _Issue(tuple(path) + ("name",), "expected a string")
    _text(node["name"], tuple(path) + ("name",), limits)
    for key in ("description", "testId", "frameworkType"):
        if key in node:
            _text(node[key], tuple(path) + (key,), limits)
    if "value" in node:
        _semantic_value(node["value"], tuple(path) + ("value",), limits)
    if "p" in node and node["p"] not in PROVENANCE_SOURCES:
        raise _Issue(tuple(path) + ("p",), "expected one of the provenance sources")
    if "px" in node:
        per_field = node["px"]
        if not isinstance(per_field, dict):
            raise _Issue(tuple(path) + ("px",), "expected an object")
        for field, source in per_field.items():
            _text(field, tuple(path) + ("px", str(field)), limits)
            if source not in PROVENANCE_SOURCES:
                raise _Issue(
                    tuple(path) + ("px", str(field)),
                    "expected one of the provenance sources",
                )
    if node.get("role") == "generic" and not node.get("frameworkType"):
        # An unrecognised widget must at least name what the framework called
        # it. An empty string carries no more than its absence, so both fail.
        raise _Issue(
            tuple(path) + ("frameworkType",),
            f"node {node.get('id')} has role 'generic' without a frameworkType; "
            "an unrecognised widget must name what the framework called it",
        )
    geometry = _obj(node.get("geometry"), tuple(path) + ("geometry",))
    _strict(geometry, ("displayed", "intendedRect", "visibleRect"), tuple(path) + ("geometry",))
    _observation(geometry.get("displayed"), tuple(path) + ("geometry", "displayed"), _bool, limits)
    _observation(geometry.get("intendedRect"), tuple(path) + ("geometry", "intendedRect"), _rect, limits)
    _observation(geometry.get("visibleRect"), tuple(path) + ("geometry", "visibleRect"), _rect, limits)
    if "scroll" in node:
        def _scroll(value: Any, scroll_path: Sequence[str]) -> None:
            item = _obj(value, scroll_path)
            _strict(item, ("axis", "offset", "viewport", "extent"), scroll_path)
            if item.get("axis") not in ("vertical", "horizontal"):
                raise _Issue(tuple(scroll_path) + ("axis",), "invalid scroll axis")
            for key in ("offset", "viewport", "extent"):
                _non_negative_int(item.get(key), tuple(scroll_path) + (key,))
            if item["offset"] + item["viewport"] > item["extent"]:
                raise _Issue(tuple(scroll_path), "scroll state must fit inside its extent")
        _observation(node["scroll"], tuple(path) + ("scroll",), _scroll, limits)
    if "paintedRegion" in node:
        _observation(
            node["paintedRegion"],
            tuple(path) + ("paintedRegion",),
            lambda value, painted_path: _painted_region(value, painted_path, limits),
            limits,
        )
    if "state" in node:
        _state(node["state"], tuple(path) + ("state",))
        state = node["state"]
        if isinstance(state, dict) and state.get("offscreen") is True and state.get("hidden") is not True:
            # Every cell outside the visible area and the node still visible
            # cannot both be true. Refusing the pair keeps `offscreen` a claim
            # about scrolling rather than a second, weaker way of saying hidden.
            raise _Issue(
                tuple(path) + ("state", "offscreen"),
                f"node {node.get('id')}: state.offscreen implies state.hidden — every cell is "
                "outside the visible area, so the node cannot also be visible",
            )
    if "extended" in node:
        if not isinstance(node["extended"], dict):
            raise _Issue(tuple(path) + ("extended",), "expected an object")
        _extended(node["extended"], tuple(path) + ("extended",), limits)
    declared_actions: Set[str] = set()
    if "actions" in node:
        actions = node["actions"]
        if not isinstance(actions, list):
            raise _Issue(tuple(path) + ("actions",), "expected an array")
        if len(actions) > len(ACTION_SET):
            raise _Issue(tuple(path) + ("actions",), "too many actions", too_big=True)
        for index, action in enumerate(actions):
            if action not in ACTION_SET:
                raise _Issue(
                    tuple(path) + ("actions", str(index)), "expected a supported semantic action"
                )
            declared_actions.add(action)
    if "inputRecipes" in node:
        _input_recipes(node["inputRecipes"], tuple(path) + ("inputRecipes",), limits)
        for index, recipe in enumerate(node["inputRecipes"]):
            action = recipe["action"]
            if action not in declared_actions:
                raise _Issue(
                    tuple(path) + ("inputRecipes", str(index), "action"),
                    f"input recipe {action!r} requires the matching semantic action intent",
                )
    for key in ("labelledBy", "describedBy"):
        if key in node:
            _relations(node[key], tuple(path) + (key,), limits)
    if "textRanges" in node:
        ranges = node["textRanges"]
        if not isinstance(ranges, list):
            raise _Issue(tuple(path) + ("textRanges",), "expected an array")
        if len(ranges) > limits.maxRelationTargets:
            raise _Issue(tuple(path) + ("textRanges",), "too many text ranges", too_big=True)
        for index, item in enumerate(ranges):
            item_path = tuple(path) + ("textRanges", str(index))
            entry = _obj(item, item_path)
            _strict(entry, ("startOffset", "endOffset", "rect"), item_path)
            for key in ("startOffset", "endOffset"):
                if key not in entry:
                    raise _Issue(item_path + (key,), "expected a non-negative safe integer")
                _non_negative_int(entry[key], item_path + (key,))
            if "rect" not in entry:
                raise _Issue(item_path + ("rect",), "expected an object")
            _rect(entry["rect"], item_path + ("rect",))


def _cursor(value: Any, path: Sequence[str]) -> None:
    cursor = _obj(value, path)
    _strict(cursor, ("row", "column", "visible", "shape"), path)
    for key in ("row", "column"):
        if key not in cursor:
            raise _Issue(tuple(path) + (key,), "expected a non-negative safe integer")
        _non_negative_int(cursor[key], tuple(path) + (key,))
    if "visible" not in cursor:
        raise _Issue(tuple(path) + ("visible",), "expected a boolean")
    _bool(cursor["visible"], tuple(path) + ("visible",))
    if "shape" in cursor and cursor["shape"] not in ("block", "underline", "bar"):
        raise _Issue(tuple(path) + ("shape",), "expected 'block', 'underline' or 'bar'")


_SNAPSHOT_KEYS = (
    "v", "sessionId", "revision", "columns", "rows", "cursor", "rootIds",
    "nodes", "coordinateSpace", "hitGrid", "providerEvidence",
)


def _snapshot_schema(value: Any, limits: ProtocolLimits) -> None:
    snapshot = _obj(value, ())
    version = snapshot.get("v")
    _strict(snapshot, _SNAPSHOT_KEYS, ())

    if version != 2:
        raise _Issue(("v",), "expected the literal 2")
    if "sessionId" not in snapshot:
        raise _Issue(("sessionId",), "expected a string")
    if _text(snapshot["sessionId"], ("sessionId",), limits) == "":
        raise _Issue(("sessionId",), "sessionId must not be empty")
    if "revision" not in snapshot:
        raise _Issue(("revision",), "expected a positive safe integer")
    _positive_int(snapshot["revision"], ("revision",))
    for key in ("columns", "rows"):
        if key not in snapshot:
            raise _Issue((key,), "expected a positive safe integer")
        _positive_int(snapshot[key], (key,))
    if "cursor" in snapshot:
        _cursor(snapshot["cursor"], ("cursor",))

    root_ids = snapshot.get("rootIds")
    if not isinstance(root_ids, list):
        raise _Issue(("rootIds",), "expected an array")
    if len(root_ids) > limits.maxNodes:
        raise _Issue(("rootIds",), f"expected at most {limits.maxNodes} items", too_big=True)
    for index, item in enumerate(root_ids):
        _text(item, ("rootIds", str(index)), limits)

    nodes = snapshot.get("nodes")
    if not isinstance(nodes, list):
        raise _Issue(("nodes",), "expected an array")
    if len(nodes) > limits.maxNodes:
        raise _Issue(("nodes",), f"expected at most {limits.maxNodes} items", too_big=True)
    for index, node in enumerate(nodes):
        _node_schema(node, ("nodes", str(index)), limits)
    if "providerEvidence" in snapshot:
        providers = snapshot["providerEvidence"]
        if not isinstance(providers, list):
            raise _Issue(("providerEvidence",), "expected an array")
        if len(providers) > 64:
            raise _Issue(("providerEvidence",), "expected at most 64 items", too_big=True)
        for index, raw_provider in enumerate(providers):
            provider_path = ("providerEvidence", str(index))
            provider = _obj(raw_provider, provider_path)
            status = _text(provider.get("status"), provider_path + ("status",), limits)
            if status == "available":
                _strict(
                    provider,
                    (
                        "providerId", "sessionId", "revision", "status", "evidence",
                        "pointerRegions", "paintedRegions", "inputModes", "focusState", "actionRecipes", "scrollStates", "hitGrid",
                    ),
                    provider_path,
                )
                provider_id = _text(
                    provider.get("providerId"), provider_path + ("providerId",), limits
                )
                if not provider_id:
                    raise _Issue(provider_path + ("providerId",), "provider id must not be empty")
                session_id = _text(
                    provider.get("sessionId"), provider_path + ("sessionId",), limits
                )
                if not session_id:
                    raise _Issue(
                        provider_path + ("sessionId",), "provider session id must not be empty"
                    )
                _positive_int(provider.get("revision"), provider_path + ("revision",))
                evidence = _obj(provider.get("evidence"), provider_path + ("evidence",))
                _evidence(evidence, provider_path + ("evidence",), limits)
                if (
                    evidence.get("source") != "application"
                    or evidence.get("method") not in ("native", "instrumented", "declared")
                    or evidence.get("strength") != "authoritative"
                ):
                    raise _Issue(
                        provider_path + ("evidence",),
                        "provider evidence must be authoritative application evidence",
                    )
                pointer_regions = provider.get("pointerRegions")
                if not isinstance(pointer_regions, list):
                    raise _Issue(provider_path + ("pointerRegions",), "expected an array")
                if len(pointer_regions) > limits.maxNodes:
                    raise _Issue(
                        provider_path + ("pointerRegions",),
                        "too many pointer regions",
                        too_big=True,
                    )
                for region_index, raw_region in enumerate(pointer_regions):
                    region_path = provider_path + ("pointerRegions", str(region_index))
                    region = _obj(raw_region, region_path)
                    _strict(region, ("recipientId", "regionBounds", "spans"), region_path)
                    recipient = _text(region.get("recipientId"), region_path + ("recipientId",), limits)
                    if not recipient:
                        raise _Issue(region_path + ("recipientId",), "recipient id must not be empty")
                    _painted_region(
                        {"regionBounds": region.get("regionBounds"), "spans": region.get("spans")},
                        region_path,
                        limits,
                    )
                if "paintedRegions" in provider:
                    painted_regions = provider["paintedRegions"]
                    if not isinstance(painted_regions, list):
                        raise _Issue(provider_path + ("paintedRegions",), "expected an array")
                    if len(painted_regions) > limits.maxNodes:
                        raise _Issue(provider_path + ("paintedRegions",), "too many painted regions", too_big=True)
                    recipients: Set[str] = set()
                    for region_index, raw_region in enumerate(painted_regions):
                        region_path = provider_path + ("paintedRegions", str(region_index))
                        region = _obj(raw_region, region_path)
                        _strict(region, ("recipientId", "regionBounds", "spans"), region_path)
                        recipient = _text(region.get("recipientId"), region_path + ("recipientId",), limits)
                        if not recipient or recipient in recipients:
                            raise _Issue(region_path + ("recipientId",), "painted region recipients must be non-empty and unique")
                        recipients.add(recipient)
                        _painted_region(
                            {"regionBounds": region.get("regionBounds"), "spans": region.get("spans")},
                            region_path,
                            limits,
                        )
                if "inputModes" in provider:
                    modes_path = provider_path + ("inputModes",)
                    modes = _obj(provider["inputModes"], modes_path)
                    _strict(modes, ("mouseTracking", "mouseEncoding", "focusReporting"), modes_path)
                    if modes.get("mouseTracking") not in ("none", "x10", "vt200", "drag", "any"):
                        raise _Issue(modes_path + ("mouseTracking",), "invalid mouse tracking mode")
                    if modes.get("mouseEncoding") not in ("default", "sgr", "urxvt", "utf8"):
                        raise _Issue(modes_path + ("mouseEncoding",), "invalid mouse encoding")
                    if modes.get("focusReporting") not in ("on", "off"):
                        raise _Issue(modes_path + ("focusReporting",), "invalid focus reporting mode")
                if "focusState" in provider:
                    focus_path = provider_path + ("focusState",)
                    focus = _obj(provider["focusState"], focus_path)
                    focus_status = _text(focus.get("status"), focus_path + ("status",), limits)
                    if focus_status == "focused":
                        _strict(focus, ("status", "recipientId"), focus_path)
                        recipient = _text(focus.get("recipientId"), focus_path + ("recipientId",), limits)
                        if not recipient:
                            raise _Issue(focus_path + ("recipientId",), "recipient id must not be empty")
                    elif focus_status == "none":
                        _strict(focus, ("status",), focus_path)
                    else:
                        raise _Issue(focus_path + ("status",), "expected focused or none")
                if "actionRecipes" in provider:
                    targets = provider["actionRecipes"]
                    if not isinstance(targets, list):
                        raise _Issue(provider_path + ("actionRecipes",), "expected an array")
                    if len(targets) > limits.maxNodes:
                        raise _Issue(
                            provider_path + ("actionRecipes",),
                            "too many action recipe recipients",
                            too_big=True,
                        )
                    recipients: Set[str] = set()
                    for target_index, raw_target in enumerate(targets):
                        target_path = provider_path + ("actionRecipes", str(target_index))
                        target = _obj(raw_target, target_path)
                        _strict(target, ("recipientId", "recipes"), target_path)
                        recipient = _text(
                            target.get("recipientId"), target_path + ("recipientId",), limits
                        )
                        if not recipient:
                            raise _Issue(
                                target_path + ("recipientId",), "recipient id must not be empty"
                            )
                        if recipient in recipients:
                            raise _Issue(
                                target_path + ("recipientId",),
                                "provider action recipe recipients must be unique",
                            )
                        recipients.add(recipient)
                        _input_recipes(target.get("recipes"), target_path + ("recipes",), limits)
                if "scrollStates" in provider:
                    states = provider["scrollStates"]
                    if not isinstance(states, list):
                        raise _Issue(provider_path + ("scrollStates",), "expected an array")
                    if len(states) > limits.maxNodes:
                        raise _Issue(provider_path + ("scrollStates",), "too many scroll recipients", too_big=True)
                    recipients: Set[str] = set()
                    for state_index, raw_state in enumerate(states):
                        state_path = provider_path + ("scrollStates", str(state_index))
                        state = _obj(raw_state, state_path)
                        _strict(state, ("recipientId", "axis", "offset", "viewport", "extent"), state_path)
                        recipient = _text(state.get("recipientId"), state_path + ("recipientId",), limits)
                        if not recipient or recipient in recipients:
                            raise _Issue(state_path + ("recipientId",), "scroll recipients must be non-empty and unique")
                        recipients.add(recipient)
                        if state.get("axis") not in ("vertical", "horizontal"):
                            raise _Issue(state_path + ("axis",), "invalid scroll axis")
                        for key in ("offset", "viewport", "extent"):
                            _non_negative_int(state.get(key), state_path + (key,))
                        if state["offset"] + state["viewport"] > state["extent"]:
                            raise _Issue(state_path, "scroll state must fit inside its extent")
            elif status in ("lost", "violation"):
                _strict(
                    provider,
                    ("providerId", "sessionId", "revision", "status", "reason"),
                    provider_path,
                )
                for key in ("providerId", "sessionId", "reason"):
                    if not _text(provider.get(key), provider_path + (key,), limits):
                        raise _Issue(provider_path + (key,), f"provider {key} must not be empty")
                _positive_int(provider.get("revision"), provider_path + ("revision",))
            else:
                raise _Issue(
                    provider_path + ("status",), "expected available, lost, or violation"
                )
    _observation(snapshot.get("coordinateSpace"), ("coordinateSpace",), lambda value, path: value in ("viewport-cells", "framework-local-cells") or (_ for _ in ()).throw(_Issue(path, "invalid coordinate space")), limits)
    def _grid(value: Any, path: Sequence[str]) -> None:
        grid = _obj(value, path)
        _strict(grid, ("regions",), path)
        regions = grid.get("regions")
        if not isinstance(regions, list) or len(regions) > limits.maxNodes:
            raise _Issue(tuple(path) + ("regions",), "invalid hit regions")
        previous = None
        for index, region_value in enumerate(regions):
            region_path = tuple(path) + ("regions", str(index))
            region = _obj(region_value, region_path)
            _strict(region, ("rect", "recipientId"), region_path)
            rect = _rect(region.get("rect"), region_path + ("rect",))
            if rect["width"] <= 0 or rect["height"] != 1:
                raise _Issue(
                    region_path + ("rect",), "hit regions must be non-empty row runs"
                )
            if previous is not None and (
                rect["row"] < previous["row"]
                or (
                    rect["row"] == previous["row"]
                    and rect["column"] < previous["column"] + previous["width"]
                )
            ):
                raise _Issue(
                    region_path + ("rect",),
                    "hit regions must be non-overlapping row-major runs",
                )
            previous = rect
            _text(region.get("recipientId"), region_path + ("recipientId",), limits)
    _observation(snapshot.get("hitGrid"), ("hitGrid",), _grid, limits)


# --------------------------------------------------------------------------
# Structural layer
# --------------------------------------------------------------------------


def _rect_intersects_viewport(rect: Mapping[str, int], columns: int, rows: int) -> bool:
    if rect["width"] == 0 or rect["height"] == 0:
        return False
    return (
        rect["column"] < columns
        and rect["row"] < rows
        and rect["column"] + rect["width"] > 0
        and rect["row"] + rect["height"] > 0
    )


def _check_node_shape(
    node: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    ids: Set[str],
    limits: ProtocolLimits,
) -> Optional[ValidationResult]:
    painted = node.get("paintedRegion")
    if isinstance(painted, dict) and painted.get("status") == "known":
        for span in painted["value"]["spans"]:
            if span["row"] >= snapshot["rows"] or span["from"] >= snapshot["columns"] or span["to"] > snapshot["columns"]:
                return _fail("bad-rect", f"node {node['id']} painted region span lies outside the viewport")
    for text_range in node.get("textRanges") or []:
        if text_range["endOffset"] < text_range["startOffset"]:
            return _fail("bad-rect", f"node {node['id']}: text range ends before it starts")
        rect = text_range["rect"]
        if abs(rect["row"] + rect["height"]) > _MAX_SAFE_INTEGER:
            return _fail(
                "bad-rect", f"node {node['id']}: text range rect overflows the safe-integer range"
            )

    for field_name in ("labelledBy", "describedBy"):
        targets = node.get(field_name)
        if targets is None:
            continue
        if len(targets) > limits.maxRelationTargets:
            return _fail(
                "count", f"node {node['id']}: {field_name} exceeds {limits.maxRelationTargets} targets"
            )
        for target in targets:
            if target not in ids:
                return _fail(
                    "missing-parent",
                    f"node {node['id']}: {field_name} references unknown node {target}",
                )
    return None


def _compute_depths(
    nodes: Sequence[Mapping[str, Any]], by_id: Mapping[str, Mapping[str, Any]]
) -> Tuple[Optional[Dict[str, int]], Optional[str]]:
    """Depth of every node (roots at 1), or the id where a parent chain closes."""
    depths: Dict[str, int] = {}
    for start in nodes:
        if start["id"] in depths:
            continue
        chain: List[str] = []
        on_chain: Set[str] = set()
        current: Optional[Mapping[str, Any]] = start
        while current is not None and current["id"] not in depths:
            if current["id"] in on_chain:
                return None, current["id"]
            on_chain.add(current["id"])
            chain.append(current["id"])
            parent_id = current.get("parentId")
            current = None if parent_id is None else by_id.get(parent_id)
        depth = 0 if current is None else depths[current["id"]]
        for node_id in reversed(chain):
            depth += 1
            depths[node_id] = depth
    return depths, None


def validate_snapshot(value: Any, limits: ProtocolLimits = DEFAULT_LIMITS) -> ValidationResult:
    """Validate an untrusted snapshot against ``limits``.

    :returns: ``ValidationResult(ok=True, snapshot=...)`` with a projected plain
        copy, or ``ValidationResult(ok=False, code=..., detail=...)``. Never raises.
    """
    try:
        projected = project_dto(value, limits.maxDepth)
    except ProtocolViolation as error:
        return _fail("depth" if error.code == "dto-depth" else "schema", str(error))

    try:
        serialised = encode_json(projected)
    except ProtocolViolation:
        return _fail("schema", "snapshot is not JSON-serialisable")
    if len(serialised) > limits.maxSnapshotBytes:
        return _fail(
            "bytes", f"snapshot is {len(serialised)} bytes, ceiling is {limits.maxSnapshotBytes}"
        )

    try:
        _snapshot_schema(projected, limits)
    except _Issue as issue:
        return _fail(issue.code, issue.detail)

    snapshot: Dict[str, Any] = projected
    nodes: List[Dict[str, Any]] = snapshot["nodes"]

    if len(nodes) > limits.maxNodes:
        return _fail("count", f"snapshot carries {len(nodes)} nodes, ceiling is {limits.maxNodes}")

    by_id: Dict[str, Dict[str, Any]] = {}
    for node in nodes:
        if node["id"] in by_id:
            return _fail("duplicate-id", f"node id {node['id']} appears more than once")
        by_id[node["id"]] = node

    root_ids: Set[str] = set()
    for node_id in snapshot["rootIds"]:
        if node_id in root_ids:
            return _fail("duplicate-id", f"root id {node_id} appears more than once")
        root_ids.add(node_id)
        root_node = by_id.get(node_id)
        if root_node is None:
            return _fail("missing-parent", f"rootIds references unknown node {node_id}")
        if root_node.get("parentId") is not None:
            return _fail("schema", f"root node {node_id} declares a parent")

    ids = set(by_id)

    if snapshot["hitGrid"]["status"] == "known":
        for region in snapshot["hitGrid"]["value"]["regions"]:
            recipient_id = region["recipientId"]
            if recipient_id not in ids:
                return _fail(
                    "missing-parent", f"hitGrid references unknown recipient {recipient_id}"
                )
            if not _rect_intersects_viewport(
                region["rect"], snapshot["columns"], snapshot["rows"]
            ):
                return _fail(
                    "bad-rect",
                    f"hitGrid region for {recipient_id} does not intersect the viewport",
                )

    provider_ids: Set[str] = set()
    for provider in snapshot.get("providerEvidence", ()):
        provider_id = provider["providerId"]
        if provider_id in provider_ids:
            return _fail("provider", f"provider evidence id {provider_id} appears more than once")
        provider_ids.add(provider_id)
        if provider["sessionId"] != snapshot["sessionId"]:
            return _fail(
                "provider",
                f"provider {provider_id} evidence session {provider['sessionId']} does not match snapshot session {snapshot['sessionId']}",
            )
        if provider["revision"] != snapshot["revision"]:
            return _fail(
                "provider",
                f"provider {provider_id} evidence revision {provider['revision']} does not match snapshot revision {snapshot['revision']}",
            )
        if provider["status"] != "available":
            continue
        if provider["evidence"]["providerId"] != provider_id:
            return _fail(
                "schema",
                f"provider {provider_id} evidence provenance names {provider['evidence']['providerId']}",
            )
        focus = provider.get("focusState")
        if focus is not None and focus["status"] == "focused" and focus["recipientId"] not in ids:
            return _fail(
                "missing-parent",
                f"provider {provider_id} focus references unknown recipient {focus['recipientId']}",
            )
        for target in provider.get("actionRecipes", ()):
            recipient_id = target["recipientId"]
            if recipient_id not in ids:
                return _fail(
                    "missing-parent",
                    f"provider {provider_id} action recipes reference unknown recipient {recipient_id}",
                )
        for state in provider.get("scrollStates", ()):
            recipient_id = state["recipientId"]
            if recipient_id not in ids:
                return _fail(
                    "missing-parent",
                    f"provider {provider_id} scroll state references unknown recipient {recipient_id}",
                )
        for region in provider.get("paintedRegions", ()):
            recipient_id = region["recipientId"]
            if recipient_id not in ids:
                return _fail(
                    "missing-parent",
                    f"provider {provider_id} painted region references unknown recipient {recipient_id}",
                )
            if any(
                span["row"] >= snapshot["rows"]
                or span["from"] >= snapshot["columns"]
                or span["to"] > snapshot["columns"]
                for span in region["spans"]
            ):
                return _fail(
                    "bad-rect",
                    f"provider {provider_id} painted region for {recipient_id} lies outside the viewport",
                )

    for node in nodes:
        parent_id = node.get("parentId")
        if parent_id is None:
            if node["id"] not in root_ids:
                return _fail("schema", f"parentless node {node['id']} is missing from rootIds")
        elif parent_id not in by_id:
            return _fail("missing-parent", f"node {node['id']} references unknown parent {parent_id}")
        elif parent_id == node["id"]:
            return _fail("cycle", f"node {node['id']} is its own parent")

        problem = _check_node_shape(node, snapshot, ids, limits)
        if problem is not None:
            return problem

    depths, cycle_at = _compute_depths(nodes, by_id)
    if cycle_at is not None:
        return _fail("cycle", f"parent chain through node {cycle_at} is cyclic")
    assert depths is not None
    for node_id, depth in depths.items():
        if depth > limits.maxDepth:
            return _fail("depth", f"node {node_id} sits at depth {depth}, ceiling is {limits.maxDepth}")

    cursor = snapshot.get("cursor")
    if cursor is not None:
        if cursor["row"] >= snapshot["rows"] or cursor["column"] >= snapshot["columns"]:
            return _fail(
                "bad-rect", f"cursor ({cursor['row']}, {cursor['column']}) lies outside the viewport"
            )

    return ValidationResult(ok=True, snapshot=snapshot)
