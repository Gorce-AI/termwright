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
    "offscreen",
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
    "frameworkType",
    "occlusion",
    "p",
    "px",
)

#: Where a semantic fact came from. Closed set, so an unknown source is a
#: rejection rather than a silently ignored annotation.
PROVENANCE_SOURCES = (
    "annotation",
    "recognizer",
    "framework",
    "correlation",
    "heuristic",
)

#: Whether the producer can say if a node's cells are covered. A producer that
#: cannot see paint order says `unknown`, and the driver refuses to click it.
OCCLUSION_VALUES = ("known", "unknown")


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
    for key in ("description", "value", "testId", "frameworkType"):
        if key in node:
            _text(node[key], tuple(path) + (key,), limits)
    if "occlusion" in node and node["occlusion"] not in OCCLUSION_VALUES:
        raise _Issue(tuple(path) + ("occlusion",), "expected 'known' or 'unknown'")
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
    if "bounds" in node:
        _rect(node["bounds"], tuple(path) + ("bounds",))
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


DELTA_KEYS = ("type", "baseRevision", "revision", "changed", "removed", "rootIds", "cursor")


def validate_tree_delta(value: Any, limits: ProtocolLimits = DEFAULT_LIMITS) -> ValidationResult:
    """Validate the SHAPE of a `tree-delta` message.

    Only the shape is checkable here. A delta carries no ``columns``/``rows``,
    so whether a parent exists, whether the tree stays acyclic and within the
    depth ceiling, and whether bounds or the cursor fall inside the viewport
    can only be judged once the delta is applied to its base — put the
    assembled tree through :func:`validate_snapshot` for that.

    What is checkable without the base: sizes, node shape, unique ids, a
    revision that moves forward, and the same id never both upserted and
    removed by one delta.
    """
    try:
        projected = project_dto(value, limits.maxDepth)
    except ProtocolViolation as error:
        return _fail("depth" if error.code == "dto-depth" else "schema", str(error))

    try:
        serialised = encode_json(projected)
    except ProtocolViolation:
        return _fail("schema", "delta is not JSON-serialisable")
    if len(serialised) > limits.maxSnapshotBytes:
        return _fail(
            "bytes", f"delta is {len(serialised)} bytes, ceiling is {limits.maxSnapshotBytes}"
        )

    try:
        _tree_delta_schema(projected, limits)
    except _Issue as issue:
        return _fail(issue.code, issue.detail)

    delta: Dict[str, Any] = projected
    changed_ids: Set[str] = set()
    for index, node in enumerate(delta["changed"]):
        if node["id"] in changed_ids:
            return _fail("duplicate-id", f"node id {node['id']} appears twice in changed")
        changed_ids.add(node["id"])
        if node.get("parentId") == node["id"]:
            return _fail("cycle", f"node {node['id']} is its own parent")
        _ = index

    removed_ids: Set[str] = set()
    for node_id in delta["removed"]:
        if node_id in removed_ids:
            return _fail("duplicate-id", f"node id {node_id} appears twice in removed")
        removed_ids.add(node_id)

    both = changed_ids & removed_ids
    if both:
        # Removals apply before upserts, so this would be a delta arguing with
        # itself about one id rather than moving a node between parents.
        return _fail(
            "schema", f"node id {sorted(both)[0]} is both changed and removed by one delta"
        )

    if "rootIds" in delta:
        seen: Set[str] = set()
        for node_id in delta["rootIds"]:
            if node_id in seen:
                return _fail("duplicate-id", f"root id {node_id} appears more than once")
            seen.add(node_id)

    return ValidationResult(ok=True, snapshot=delta)


def _tree_delta_schema(value: Any, limits: ProtocolLimits) -> None:
    delta = _obj(value, ())
    _strict(delta, DELTA_KEYS, ())

    base = _positive_int(delta.get("baseRevision"), ("baseRevision",))
    revision = _positive_int(delta.get("revision"), ("revision",))
    if revision <= base:
        raise _Issue(
            ("revision",), f"revision {revision} must move forward from base {base}"
        )

    changed = delta.get("changed")
    if not isinstance(changed, list):
        raise _Issue(("changed",), "expected an array")
    if len(changed) > limits.maxNodes:
        raise _Issue(("changed",), f"expected at most {limits.maxNodes} items", too_big=True)
    for index, node in enumerate(changed):
        _node_schema(node, ("changed", str(index)), limits)

    removed = delta.get("removed")
    if not isinstance(removed, list):
        raise _Issue(("removed",), "expected an array")
    if len(removed) > limits.maxNodes:
        raise _Issue(("removed",), f"expected at most {limits.maxNodes} items", too_big=True)
    for index, node_id in enumerate(removed):
        if _text(node_id, ("removed", str(index)), limits) == "":
            raise _Issue(("removed", str(index)), "node id must not be empty")

    if "rootIds" in delta:
        root_ids = delta["rootIds"]
        if not isinstance(root_ids, list):
            raise _Issue(("rootIds",), "expected an array")
        if len(root_ids) > limits.maxNodes:
            raise _Issue(("rootIds",), f"expected at most {limits.maxNodes} items", too_big=True)
        for index, node_id in enumerate(root_ids):
            _text(node_id, ("rootIds", str(index)), limits)

    if "cursor" in delta:
        _cursor(delta["cursor"], ("cursor",))


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


def apply_tree_delta(
    base: Mapping[str, Any], delta: Mapping[str, Any], limits: ProtocolLimits = DEFAULT_LIMITS
) -> ValidationResult:
    """Compose a delta onto the snapshot it names, then validate the result.

    The four composition rules, in the order they are applied:

    1. ``removed`` takes each id **with its whole subtree**. The cascade is
       what keeps a delta small — dropping a dialog is one id, not one per
       descendant — and it is the only rule that leaves no orphans behind.
    2. Removals happen **before** upserts, so one delta can move a node out of
       a subtree it is deleting.
    3. ``changed`` upserts by id, **replacing a node wholesale**. Merging would
       need a third state meaning "clear this optional field", which the wire
       cannot express.
    4. ``rootIds`` present replaces the list; absent inherits the base's minus
       whatever the removals took. Adding a new root therefore *requires*
       sending ``rootIds`` — otherwise the parentless node is missing from the
       root list and validation says so, loudly.

    An absent ``cursor`` is inherited; there is no way to remove one, and none
    is needed, because hiding it is ``visible: false``.

    A base that disagrees is reported rather than patched around: the caller
    asks for a full snapshot instead of guessing (§8.3).

    The composed tree then goes through :func:`validate_snapshot`, because a
    delta is trusted to *describe* a valid tree, never to produce one.
    """
    if delta.get("baseRevision") != base.get("revision"):
        return _fail(
            "revision",
            f"delta is based on revision {delta.get('baseRevision')} but the held snapshot "
            f"is revision {base.get('revision')}; request a full snapshot instead of patching",
        )

    by_id: Dict[str, Any] = {node["id"]: node for node in base["nodes"]}

    children_of: Dict[str, List[str]] = {}
    for node in base["nodes"]:
        parent = node.get("parentId")
        if parent is not None:
            children_of.setdefault(parent, []).append(node["id"])

    for node_id in delta["removed"]:
        if node_id not in by_id:
            return _fail(
                "missing-parent",
                f"delta removes unknown node {node_id}; the producer's base disagrees with "
                "ours, so the tree must be resynchronised rather than patched",
            )
        # Iterative descent: a hostile delta must not be able to blow the stack.
        pending = [node_id]
        while pending:
            current = pending.pop()
            if by_id.pop(current, None) is None:
                continue
            pending.extend(children_of.get(current, ()))

    for node in delta["changed"]:
        by_id[node["id"]] = node

    if "rootIds" in delta:
        root_ids = list(delta["rootIds"])
    else:
        root_ids = [node_id for node_id in base["rootIds"] if node_id in by_id]

    cursor = delta.get("cursor", base.get("cursor"))

    composed: Dict[str, Any] = {
        "v": 1,
        "sessionId": base["sessionId"],
        "revision": delta["revision"],
        "columns": base["columns"],
        "rows": base["rows"],
    }
    if cursor is not None:
        composed["cursor"] = cursor
    composed["rootIds"] = root_ids
    composed["nodes"] = list(by_id.values())

    return validate_snapshot(composed, limits)
