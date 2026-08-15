"""Snapshot validation.

A structural port of ``validate.ts``: same invariants, same error codes, same
order of checks, so a snapshot rejected here is rejected by the driver and vice
versa. Never raises on hostile input — failures come back as a result object.
"""

from __future__ import annotations

from dataclasses import dataclass
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
        if "bounds" in self.path or "rect" in self.path:
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
    "readonly",
    "multiline",
)
_STATE_KEYS = _STATE_BOOLS + (
    "checked",
    "orientation",
    "level",
    "positionInSet",
    "setSize",
    "scrollOffset",
    "scrollExtent",
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
    for key in ("setSize", "scrollOffset", "scrollExtent"):
        if key in state:
            _non_negative_int(state[key], tuple(path) + (key,))


_NODE_KEYS = (
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
)


def _relations(value: Any, path: Sequence[str], limits: ProtocolLimits) -> None:
    if not isinstance(value, list):
        raise _Issue(path, "expected an array")
    if len(value) > limits.maxRelationTargets:
        raise _Issue(path, f"expected at most {limits.maxRelationTargets} items", too_big=True)
    for index, item in enumerate(value):
        _text(item, tuple(path) + (str(index),), limits)


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
        raise _Issue(tuple(path) + ("role",), "expected one of the v1 semantic roles")
    if "name" not in node:
        raise _Issue(tuple(path) + ("name",), "expected a string")
    _text(node["name"], tuple(path) + ("name",), limits)
    for key in ("description", "value", "testId"):
        if key in node:
            _text(node[key], tuple(path) + (key,), limits)
    if "bounds" in node:
        _rect(node["bounds"], tuple(path) + ("bounds",))
    if "state" in node:
        _state(node["state"], tuple(path) + ("state",))
    if "actions" in node:
        actions = node["actions"]
        if not isinstance(actions, list):
            raise _Issue(tuple(path) + ("actions",), "expected an array")
        if len(actions) > len(ACTION_SET):
            raise _Issue(tuple(path) + ("actions",), "too many actions", too_big=True)
        for index, action in enumerate(actions):
            if action not in ACTION_SET:
                raise _Issue(
                    tuple(path) + ("actions", str(index)), "expected one of the v1 semantic actions"
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


_SNAPSHOT_KEYS = ("v", "sessionId", "revision", "columns", "rows", "cursor", "rootIds", "nodes")


def _snapshot_schema(value: Any, limits: ProtocolLimits) -> None:
    snapshot = _obj(value, ())
    _strict(snapshot, _SNAPSHOT_KEYS, ())

    if snapshot.get("v") != 1:
        raise _Issue(("v",), "expected the literal 1")
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
    bounds = node.get("bounds")
    if bounds is not None:
        if (
            abs(bounds["row"] + bounds["height"]) > _MAX_SAFE_INTEGER
            or abs(bounds["column"] + bounds["width"]) > _MAX_SAFE_INTEGER
        ):
            return _fail("bad-rect", f"node {node['id']}: bounds overflow the safe-integer range")
        hidden = (node.get("state") or {}).get("hidden") is True
        if not hidden and not _rect_intersects_viewport(bounds, snapshot["columns"], snapshot["rows"]):
            return _fail(
                "bad-rect",
                f"node {node['id']}: bounds do not intersect the "
                f"{snapshot['columns']}x{snapshot['rows']} viewport and the node is not hidden",
            )

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
        node = by_id.get(node_id)
        if node is None:
            return _fail("missing-parent", f"rootIds references unknown node {node_id}")
        if node.get("parentId") is not None:
            return _fail("schema", f"root node {node_id} declares a parent")

    ids = set(by_id)

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
