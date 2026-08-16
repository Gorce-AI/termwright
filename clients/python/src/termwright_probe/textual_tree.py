"""Turning one observed Textual frame into a semantic tree.

What this does differently from the hand-written adapter it replaces, each
point traceable to a measurement in `docs/architecture/audit/textual.md`:

**`bounds` is the visible rectangle.** `Widget.region` is where the widget
sits in screen coordinates whether or not a container clips it; the audit
found the adapter publishing that, which reports cells the user cannot see for
anything scrolled halfway out of a viewport. The truth is
`MapGeometry.visible_region`, defined by Textual as `clip ∩ region`.

**Paint order is real here.** Textual's compositor sorts widgets by
`MapGeometry.order` (`_compositor.py:763`), a per-ancestor tuple that compares
lexicographically. Ranking the frame's widgets by that same key gives a
`paintOrder` that is Textual's own answer rather than our guess, which is what
lets every node claim `occlusion: 'known'` and unlocks pointer actions the
driver otherwise refuses.

**Not displayed and scrolled out of view stop being the same fact.** Both are
`hidden`, because v1 has one flag, but they are encoded differently and both
encodings validate: a widget Textual is not displaying carries no `bounds` at
all, while one that is displayed and entirely clipped carries a zero-area
rectangle at its own origin. A consumer can tell them apart; neither invents a
field.

The Textual knowledge below — which class means which role, where a widget
keeps its text — is deliberately copied from the adapter rather than imported
from it. The adapter is the thing this replaces, and a probe that imported it
would inherit its decisions instead of making its own. Phase 9 deletes the
adapter and the duplication with it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple
from weakref import WeakKeyDictionary

from termwright.tree import Rect, SemanticNode, SemanticSnapshot, SemanticState

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

    def of(self, widget: Any) -> str:
        existing = self._ids.get(widget)
        if existing is not None:
            return existing
        self._next += 1
        assigned = f"w{self._next}"
        self._ids[widget] = assigned
        return assigned


def role_for(widget: Any) -> str:
    """Semantic role: the author's annotation, then the class ancestry."""
    override = getattr(widget, "termwright_role", None)
    if isinstance(override, str) and override:
        return override
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


def name_for(widget: Any, role: Optional[str] = None) -> str:
    """Accessible name: annotation, then own text, then contents, then id."""
    override = getattr(widget, "termwright_name", None)
    if isinstance(override, str):
        return override

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


def test_id_for(widget: Any) -> Optional[str]:
    """Test id: the author's annotation, then Textual's own DOM id."""
    annotated = getattr(widget, "termwright_test_id", None)
    if isinstance(annotated, str) and annotated:
        return annotated
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


class Observation:
    """One widget as the probe found it, before it becomes a node."""

    __slots__ = ("widget", "geometry", "displayed", "paint_order")

    def __init__(self, widget: Any, geometry: Any, displayed: bool) -> None:
        self.widget = widget
        self.geometry = geometry
        self.displayed = displayed
        self.paint_order: Optional[int] = None


def observe(app: Any) -> List[Observation]:
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

    observations: List[Observation] = []
    for widget in widgets:
        displayed = bool(getattr(widget, "display", True)) and bool(
            getattr(widget, "visible", True)
        )
        geometry = None
        try:
            geometry = screen.find_widget(widget)
        except Exception:
            # A widget the compositor does not know about — mid-mount, or on a
            # screen that is no longer active. It has no geometry this frame,
            # which is a fact rather than an error.
            geometry = None
        observations.append(Observation(widget, geometry, displayed))

    _rank_paint_order(observations)
    return observations


def _rank_paint_order(observations: List[Observation]) -> None:
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
        # claim of one. Every node then reports occlusion 'unknown'.
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
    screen = app.screen
    focused = getattr(app, "focused", None)

    nodes: List[SemanticNode] = []
    root_ids: List[str] = []
    for item in observations:
        widget = item.widget
        role = role_for(widget)
        node_id = identities.of(widget)

        parent_id: Optional[str] = None
        parent = getattr(widget, "parent", None)
        while parent is not None and id(parent) not in included:
            parent = getattr(parent, "parent", None)
        if parent is not None and parent is not widget:
            parent_id = identities.of(parent)
        if parent_id is None:
            root_ids.append(node_id)

        bounds, hidden = _geometry_of(item)
        annotated = _annotated_fields(widget)
        nodes.append(
            SemanticNode(
                id=node_id,
                parentId=parent_id,
                role=role,
                name=_app_name(app) if widget is screen else name_for(widget, role),
                testId=test_id_for(widget),
                value=value_for(widget, role),
                bounds=bounds,
                state=_state_of(item, widget, focused, hidden),
                actions=actions_for(role),
                frameworkType=type(widget).__name__ if role == "generic" else None,
                occlusion="known" if item.paint_order is not None else "unknown",
                p="framework",
                px=annotated or None,
            )
        )

    return SemanticSnapshot(
        sessionId=session_id,
        revision=revision,
        columns=int(getattr(app, "size", _Size()).width),
        rows=int(getattr(app, "size", _Size()).height),
        rootIds=root_ids,
        nodes=nodes,
    )


class _Size:
    """Fallback when the app has no size yet — an unstarted app has none."""

    width = 80
    height = 24


def _app_name(app: Any) -> str:
    title = getattr(app, "title", None)
    if isinstance(title, str) and title:
        return title
    return type(app).__name__


def _geometry_of(item: Observation) -> Tuple[Optional[Rect], bool]:
    """Bounds to publish, and whether the node counts as hidden.

    Three cases, and the encoding keeps two of them apart that v1's single
    `hidden` flag would otherwise merge:

    - not displayed: no bounds at all;
    - displayed but entirely clipped: a zero-area rect at its own origin, which
      says "it is somewhere, and none of it is on screen";
    - visible: the intersection of its region with the clip.
    """
    if not item.displayed:
        return None, True
    if item.geometry is None:
        return None, True

    visible = _rect(getattr(item.geometry, "visible_region", None))
    if visible is None:
        # An older Textual without the property: fall back to the region and
        # say so by refusing the occlusion claim elsewhere.
        return _rect(getattr(item.geometry, "region", None)), False
    if visible.width == 0 or visible.height == 0:
        region = _rect(getattr(item.geometry, "region", None))
        origin = region if region is not None else visible
        return Rect(row=origin.row, column=origin.column, width=0, height=0), True
    return visible, False


def _state_of(item: Observation, widget: Any, focused: Any, hidden: bool) -> Optional[SemanticState]:
    is_focused = focused is widget
    checked: Optional[bool] = None
    if role_for(widget) in ("checkbox", "radio"):
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
        checked=checked,
        expanded=(not collapsed) if isinstance(collapsed, bool) else None,
        multiline=True if type(widget).__name__ == "TextArea" else None,
        readonly=True if read_only is True else None,
    )
    return state if state.to_wire() else None


def _annotated_fields(widget: Any) -> Dict[str, str]:
    """Per-field provenance for whatever the author annotated by hand.

    The node as a whole is `framework` — we read it from Textual — but a name
    or a test id the author wrote is theirs, and a consumer resolving a
    conflict needs to know which is which.
    """
    annotated: Dict[str, str] = {}
    if isinstance(getattr(widget, "termwright_name", None), str):
        annotated["name"] = "annotation"
    if isinstance(getattr(widget, "termwright_role", None), str):
        annotated["role"] = "annotation"
    if isinstance(getattr(widget, "termwright_test_id", None), str):
        annotated["testId"] = "annotation"
    return annotated
