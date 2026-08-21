"""Turning one observed Textual frame into a semantic tree.

What this does differently from the hand-written adapter it replaces, each
point traceable to a measurement in `docs/architecture/audit/textual.md`:

**Geometry is evidence-qualified.** `Widget.region` reports intended layout;
`MapGeometry.visible_region` reports Textual's `clip ∩ region`. Both facts are
published independently, so missing geometry never becomes a guessed rectangle.

**Paint order is real here.** Textual's compositor sorts widgets by
`MapGeometry.order` (`_compositor.py:763`), a per-ancestor tuple that compares
lexicographically. Ranking the frame's widgets by that same key gives a
`paintOrder` that is Textual's own answer rather than our guess. Pointer
ownership comes separately from Textual's exact `get_widget_at` result.

**Not displayed and scrolled out of view are different facts, and the tree now
says which.** A widget Textual is not displaying has absent geometry. One that
is displayed and entirely clipped has a known intended rectangle and a known
zero-area visible rectangle. `state.offscreen` records the latter case.

The Textual knowledge below — which class means which role, where a widget
keeps its text — is deliberately copied from the adapter rather than imported
from it. The adapter is the thing this replaces, and a probe that imported it
would inherit its decisions instead of making its own. Phase 9 deletes the
adapter and the duplication with it.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional, Sequence, Tuple
from weakref import WeakKeyDictionary

from termwright.textual import ResolvedAnnotation, resolve_annotation
from termwright.tree import (
    NodeGeometryObservations,
    Observation as WireObservation,
    Rect,
    SemanticNode,
    SemanticSnapshot,
    SemanticState,
    framework_evidence,
)

#: Widget class name → semantic role, walked along the MRO so a subclass of a
#: mapped widget inherits its role with no registration at all: `SaveButton`
#: derived from `Button` is a button because Python already says so.
ROLE_BY_CLASS: Dict[str, str] = {
    "Button": "button",
    "Input": "textbox",
    "MaskedInput": "textbox",
    "TextArea": "textbox",
    "Checkbox": "checkbox",
    "Switch": "checkbox",
    "RadioButton": "radio",
    "ToggleButton": "checkbox",
    "DataTable": "table",
    "ListView": "list",
    "ListItem": "listitem",
    "OptionList": "list",
    "SelectionList": "list",
    "RadioSet": "list",
    "Select": "list",
    "Tree": "list",
    "DirectoryTree": "list",
    "Tabs": "list",
    "Tab": "tab",
    "TabPane": "region",
    "TabbedContent": "region",
    "Label": "text",
    "Static": "text",
    "Digits": "text",
    "Pretty": "text",
    "Markdown": "text",
    "MarkdownViewer": "region",
    "RichLog": "text",
    "Log": "text",
    "Sparkline": "progressbar",
    "ProgressBar": "progressbar",
    "LoadingIndicator": "status",
    "Toast": "alert",
    "Rule": "separator",
    "ScrollBar": "scrollbar",
    "Header": "region",
    "Footer": "region",
    "Collapsible": "region",
    "ContentSwitcher": "region",
    "Container": "region",
    "ScrollableContainer": "region",
    "Horizontal": "region",
    "Vertical": "region",
    "Grid": "region",
    "Center": "region",
    "Middle": "region",
    "ModalScreen": "dialog",
    "Screen": "application",
    "Widget": "generic",
}

#: Roles whose accessible name comes from what they contain, per the adapter
#: conventions in the protocol README.
NAME_FROM_CONTENT_ROLES = frozenset(
    {"listitem", "menuitem", "tab", "button", "checkbox", "radio", "cell", "row", "heading"}
)

#: Longest name derived from a node's contents, in characters.
MAX_CONTENT_NAME = 200


class Identities:
    """Stable node ids for the lifetime of each widget object.

    Textual keeps a retained DOM, so a widget object survives between frames
    and its identity can be tracked — the property Ratatui cannot offer at all.
    A `recompose` builds new objects, and those correctly get new ids: the node
    really is new, and pretending otherwise would report a change where a
    replacement happened.
    """

    def __init__(self) -> None:
        self._ids: "WeakKeyDictionary[Any, str]" = WeakKeyDictionary()
        self._next = 0

    def of(self, widget: Any, semantic_key: Optional[str] = None) -> str:
        if semantic_key is not None:
            return f"k:{semantic_key}"
        existing = self._ids.get(widget)
        if existing is not None:
            return existing
        self._next += 1
        assigned = f"w{self._next}"
        self._ids[widget] = assigned
        return assigned


class DuplicateSemanticKeyError(ValueError):
    """An explicit application identity was not unique in one frame."""


def role_for(widget: Any, annotation: Optional[ResolvedAnnotation] = None) -> str:
    """Semantic role: the SDK annotation, then the class ancestry."""
    resolved = annotation if annotation is not None else resolve_annotation(widget)
    if resolved.role is not None:
        return resolved.role
    for klass in type(widget).__mro__:
        role = ROLE_BY_CLASS.get(klass.__name__)
        if role is not None:
            return role
    return "generic"


def _first_text(*candidates: Any) -> str:
    for candidate in candidates:
        if candidate is None:
            continue
        if isinstance(candidate, str):
            if candidate:
                return candidate
            continue
        text = str(candidate).strip()
        if text:
            return text
    return ""


def name_from_content(widget: Any) -> str:
    """Join the text of a widget's descendants, as ARIA names from content."""
    try:
        descendants = widget.query("*")
    except Exception:
        return ""
    parts: List[str] = []
    for child in descendants:
        text = _first_text(
            getattr(child, "label", None),
            getattr(child, "content", None),
            getattr(child, "renderable", None),
        ).strip()
        if text:
            parts.append(text)
    return " ".join(parts)[:MAX_CONTENT_NAME].strip()


def name_for(
    widget: Any,
    role: Optional[str] = None,
    annotation: Optional[ResolvedAnnotation] = None,
) -> str:
    """Accessible name: annotation, then own text, then contents, then id."""
    resolved = annotation if annotation is not None else resolve_annotation(widget)
    if resolved.name is not None:
        return resolved.name

    own = _first_text(
        getattr(widget, "label", None),
        getattr(widget, "placeholder", None),
        getattr(widget, "content", None),
        getattr(widget, "renderable", None),
    )
    if own:
        return own
    if role in NAME_FROM_CONTENT_ROLES:
        from_content = name_from_content(widget)
        if from_content:
            return from_content
    return _first_text(getattr(widget, "name", None), getattr(widget, "id", None))


def test_id_for(widget: Any, annotation: Optional[ResolvedAnnotation] = None) -> Optional[str]:
    """Test id: the author's annotation, then Textual's own DOM id."""
    resolved = annotation if annotation is not None else resolve_annotation(widget)
    if resolved.test_id is not None:
        return resolved.test_id
    native = getattr(widget, "id", None)
    return native if isinstance(native, str) and native else None


def actions_for(role: str) -> Optional[Sequence[str]]:
    if role in ("button", "menuitem", "tab"):
        return ("focus", "activate")
    if role in ("checkbox", "radio"):
        return ("focus", "toggle")
    if role == "textbox":
        return ("focus", "setValue")
    if role in ("list", "table"):
        return ("focus", "scroll", "select")
    return None


def value_for(widget: Any, role: str) -> Optional[str]:
    """Current value of a value-bearing widget, as text.

    `''` is a value: it says the field is empty, where absence says the widget
    does not bear one at all.
    """
    if role not in ("textbox", "progressbar"):
        return None
    value = getattr(widget, "text", None) if role == "textbox" else None
    if not isinstance(value, str):
        value = getattr(widget, "value", None)
    if isinstance(value, bool) or value is None:
        return None
    return value if isinstance(value, str) else str(value)


def _rect(region: Any) -> Optional[Rect]:
    """A Textual `Region` as a protocol rect, or `None` when there is none."""
    if region is None:
        return None
    try:
        return Rect(
            row=int(region.y),
            column=int(region.x),
            width=max(0, int(region.width)),
            height=max(0, int(region.height)),
        )
    except (AttributeError, TypeError, ValueError):
        return None


class WidgetObservation:
    """One widget as the probe found it, before it becomes a node."""

    __slots__ = ("widget", "geometry", "displayed", "paint_order")

    def __init__(self, widget: Any, geometry: Any, displayed: bool) -> None:
        self.widget = widget
        self.geometry = geometry
        self.displayed = displayed
        self.paint_order: Optional[int] = None


def observe(app: Any) -> List[WidgetObservation]:
    """Read the active screen: every widget, its geometry and its display flag.

    Called from `post_display_hook`, where the compositor has finished, so the
    geometry is this frame's rather than the previous one's.
    """
    screen = app.screen
    widgets = [screen]
    try:
        widgets.extend(screen.query("*"))
    except Exception:
        pass

    observations: List[WidgetObservation] = []
    for widget in widgets:
        displayed = True
        ancestor = widget
        while ancestor is not None:
            displayed = displayed and bool(getattr(ancestor, "display", True)) and bool(
                getattr(ancestor, "visible", True)
            )
            ancestor = getattr(ancestor, "parent", None)
        geometry = None
        try:
            geometry = screen.find_widget(widget)
        except Exception:
            # A widget the compositor does not know about — mid-mount, or on a
            # screen that is no longer active. It has no geometry this frame,
            # which is a fact rather than an error.
            geometry = None
        observations.append(WidgetObservation(widget, geometry, displayed))

    _rank_paint_order(observations)
    return observations


def _rank_paint_order(observations: List[WidgetObservation]) -> None:
    """Rank by Textual's own compositing key, so later means on top.

    `MapGeometry.order` is a tuple of per-ancestor triples and compares
    lexicographically; the compositor sorts by exactly this. Ranking rather
    than publishing the tuple keeps the wire field an integer without losing
    the ordering it encodes.
    """
    ordered = [
        item
        for item in observations
        if item.geometry is not None and getattr(item.geometry, "order", None) is not None
    ]
    try:
        ordered.sort(key=lambda item: item.geometry.order)
    except TypeError:
        # Mixed key shapes across Textual versions: no honest ranking, so no
        # claim of one. Pointer ownership still comes from `get_widget_at`.
        return
    for rank, item in enumerate(ordered):
        item.paint_order = rank


def build_snapshot(
    app: Any,
    identities: Identities,
    *,
    session_id: str,
    revision: int,
) -> SemanticSnapshot:
    """The semantic tree for the frame that just landed."""
    observations = observe(app)
    included = {id(item.widget) for item in observations}
    annotations = {id(item.widget): _probe_annotation(item.widget) for item in observations}
    key_counts = Counter(
        annotation.key for annotation in annotations.values() if annotation.key is not None
    )
    duplicates = sorted(str(key) for key, count in key_counts.items() if count > 1)
    if duplicates:
        raise DuplicateSemanticKeyError(
            "duplicate SemanticKey values: " + ", ".join(repr(key) for key in duplicates[:16])
        )
    semantic_keys = {
        widget_id: annotation.key
        for widget_id, annotation in annotations.items()
    }
    screen = app.screen
    focused = getattr(app, "focused", None)

    nodes: List[SemanticNode] = []
    root_ids: List[str] = []
    for item in observations:
        widget = item.widget
        annotation = annotations[id(widget)]
        role = role_for(widget, annotation)
        semantic_key = semantic_keys[id(widget)]
        node_id = identities.of(widget, semantic_key)

        parent_id: Optional[str] = None
        parent = getattr(widget, "parent", None)
        while parent is not None and id(parent) not in included:
            parent = getattr(parent, "parent", None)
        if parent is not None and parent is not widget:
            parent_id = identities.of(parent, semantic_keys[id(parent)])
        if parent_id is None:
            root_ids.append(node_id)

        hidden, offscreen = _visibility_flags(item)
        intended = _rect(getattr(item.geometry, "region", None)) if item.geometry is not None else None
        visible = _rect(getattr(item.geometry, "visible_region", None)) if item.geometry is not None else None
        if not item.displayed:
            absent = WireObservation(status="absent", reason="not-displayed", evidence=framework_evidence("textual-compositor"))
            geometry = NodeGeometryObservations(
                displayed=WireObservation(status="known", value=False, evidence=framework_evidence("textual-probe")),
                intendedRect=absent,
                visibleRect=absent,
            )
        elif item.geometry is None:
            absent = WireObservation(status="absent", reason="not-laid-out", evidence=framework_evidence("textual-compositor"))
            geometry = NodeGeometryObservations(
                displayed=WireObservation(status="known", value=True, evidence=framework_evidence("textual-probe")),
                intendedRect=absent,
                visibleRect=absent,
            )
        else:
            geometry = NodeGeometryObservations(
                displayed=WireObservation(status="known", value=True, evidence=framework_evidence("textual-probe")),
                intendedRect=(WireObservation(status="known", value=intended, evidence=framework_evidence("textual-probe")) if intended is not None else WireObservation(status="absent", reason="not-laid-out", evidence=framework_evidence("textual-compositor"))),
                visibleRect=(WireObservation(status="known", value=visible, evidence=framework_evidence("textual-compositor")) if visible is not None else WireObservation(status="unsupported", capability="clipped-geometry", reason="framework-unobservable")),
            )
        annotated = _annotated_fields(annotation, semantic_key is not None)
        nodes.append(
            SemanticNode(
                id=node_id,
                parentId=parent_id,
                role=role,
                name=(
                    annotation.name
                    if widget is screen and annotation.name is not None
                    else _app_name(app)
                    if widget is screen
                    else name_for(widget, role, annotation)
                ),
                description=annotation.description,
                testId=test_id_for(widget, annotation),
                value=value_for(widget, role),
                state=_state_of(item, widget, role, focused, hidden, offscreen),
                extended=annotation.extended,
                actions=(
                    annotation.actions
                    if annotation.actions is not None
                    else actions_for(role)
                ),
                labelledBy=_relationship_ids(
                    annotation.labelled_by, included, identities, semantic_keys
                ),
                describedBy=_relationship_ids(
                    annotation.described_by, included, identities, semantic_keys
                ),
                frameworkType=type(widget).__name__ if role == "generic" else None,
                p="framework",
                px=annotated or None,
                geometry=geometry,
            )
        )

    hit_regions = _hit_regions(screen, observations, identities, semantic_keys)

    return SemanticSnapshot(
        sessionId=session_id,
        revision=revision,
        columns=int(getattr(app, "size", _Size()).width),
        rows=int(getattr(app, "size", _Size()).height),
        rootIds=root_ids,
        nodes=nodes,
        v=2,
        coordinateSpace=WireObservation(status="known", value="viewport-cells", evidence=framework_evidence("textual-probe")),
        hitGrid=(
            WireObservation(status="known", value={"regions": hit_regions}, evidence=framework_evidence("textual-compositor-hit-grid"))
            if hit_regions is not None
            else WireObservation(status="unsupported", capability="pointer-hit-grid", reason="framework-unobservable")
        ),
    )


def _hit_regions(
    screen: Any,
    observations: Sequence[WidgetObservation],
    identities: Identities,
    semantic_keys: Dict[int, Optional[str]],
) -> Optional[List[Dict[str, Any]]]:
    """Compress Textual's exact fresh-pointer recipient map into row runs."""
    by_object = {id(item.widget): identities.of(item.widget, semantic_keys[id(item.widget)]) for item in observations}
    width = max(0, int(getattr(getattr(screen, "size", None), "width", 0)))
    height = max(0, int(getattr(getattr(screen, "size", None), "height", 0)))
    regions: List[Dict[str, Any]] = []
    lookup = getattr(screen, "get_widget_at", None)
    if not callable(lookup):
        return None
    for row in range(height):
        run_owner: Optional[str] = None
        run_start = 0
        for column in range(width + 1):
            owner: Optional[str] = None
            if column < width:
                try:
                    widget, _region = lookup(column, row)
                    if not bool(getattr(widget, "loading", False)):
                        owner = by_object.get(id(widget))
                        if owner is None:
                            # A known framework recipient without a semantic id
                            # is not "no recipient". Refuse the entire complete
                            # map rather than manufacture a false empty cell.
                            return None
                except Exception:
                    owner = None
            if owner == run_owner:
                continue
            if run_owner is not None:
                regions.append({"rect": {"row": row, "column": run_start, "width": column - run_start, "height": 1}, "recipientId": run_owner})
            run_owner = owner
            run_start = column
    return regions


class _Size:
    """Fallback when the app has no size yet — an unstarted app has none."""

    width = 80
    height = 24


def _app_name(app: Any) -> str:
    title = getattr(app, "title", None)
    if isinstance(title, str) and title:
        return title
    return type(app).__name__


def _visibility_flags(item: WidgetObservation) -> Tuple[bool, bool]:
    """Return only visibility facts Textual actually exposes."""
    if not item.displayed:
        return True, False
    if item.geometry is None:
        return False, False

    visible = _rect(getattr(item.geometry, "visible_region", None))
    if visible is None:
        return False, False
    if visible.width == 0 or visible.height == 0:
        return True, True
    return False, False


def _state_of(
    item: WidgetObservation,
    widget: Any,
    role: str,
    focused: Any,
    hidden: bool,
    offscreen: bool,
) -> Optional[SemanticState]:
    is_focused = focused is widget
    checked: Optional[bool] = None
    if role in ("checkbox", "radio"):
        value = getattr(widget, "value", None)
        if isinstance(value, bool):
            checked = value
    collapsed = getattr(widget, "collapsed", None)
    read_only = getattr(widget, "read_only", None)

    state = SemanticState(
        # Nothing off-screen holds the focus, whatever the app still points at.
        focused=True if is_focused and not hidden else None,
        disabled=True if bool(getattr(widget, "disabled", False)) else None,
        hidden=True if hidden else None,
        # Only claimed for a node Textual laid out and then clipped entirely
        # away; a widget with display off is hidden without being anywhere.
        offscreen=True if offscreen else None,
        checked=checked,
        expanded=(not collapsed) if isinstance(collapsed, bool) else None,
        multiline=True if type(widget).__name__ == "TextArea" else None,
        readonly=True if read_only is True else None,
    )
    return state if state.to_wire() else None


def _relationship_ids(
    targets: Sequence[Any],
    included: set,
    identities: Identities,
    semantic_keys: Dict[int, Optional[str]],
) -> Optional[Sequence[str]]:
    resolved: List[str] = []
    for target in targets:
        target_id = id(target)
        if target_id not in included:
            continue
        resolved.append(identities.of(target, semantic_keys[target_id]))
    return tuple(resolved) if resolved else None


def _probe_annotation(widget: Any) -> ResolvedAnnotation:
    """A broken optional annotation must not remove the framework's facts.

    Static invalid roles are rejected when the decorator is created. Dynamic
    getters can still throw or return a value of the wrong type later; the
    side-channel then ignores that annotation for this frame instead of
    failing the entire snapshot or reaching into the application's render.
    """
    try:
        return resolve_annotation(widget)
    except Exception:
        return ResolvedAnnotation()


def _annotated_fields(
    annotation: ResolvedAnnotation, semantic_key_applied: bool = True
) -> Dict[str, str]:
    """Per-field provenance for whatever the author annotated by hand.

    The node as a whole is `framework` — we read it from Textual — but a name
    or a test id the author wrote is theirs, and a consumer resolving a
    conflict needs to know which is which.
    """
    annotated: Dict[str, str] = {}
    if annotation.name is not None:
        annotated["name"] = "annotation"
    if annotation.role is not None:
        annotated["role"] = "annotation"
    if annotation.description is not None:
        annotated["description"] = "annotation"
    if annotation.test_id is not None:
        annotated["testId"] = "annotation"
    if annotation.extended is not None:
        annotated["extended"] = "annotation"
    if annotation.labelled_by:
        annotated["labelledBy"] = "annotation"
    if annotation.described_by:
        annotated["describedBy"] = "annotation"
    if annotation.actions is not None:
        annotated["actions"] = "annotation"
    if semantic_key_applied and annotation.key is not None:
        annotated["id"] = "annotation"
    return annotated
