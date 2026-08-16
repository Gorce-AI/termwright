"""Textual adapter: publishes the widget tree as a semantic snapshot.

Attach it to an existing app with :func:`enable_semantics`, or inherit from
:class:`TermwrightApp`. Either way the app is untouched when the driver is not
present: without ``TERMWRIGHT_ENDPOINT``/``TERMWRIGHT_TOKEN`` nothing is
imported into the render path, no socket is opened, and no marker is written.

The publish point is Textual's ``post_display_hook``, which runs immediately
after the driver has flushed a frame — the exact moment the marker is defined
to commit. Textual's own ``Pilot`` and ``run_test()`` are untouched: this
adapter only reads the DOM, so semantic tests and pilot tests can coexist in
one suite.

Roles come from the widget class (first match walking the MRO). Any widget can
override them with ``termwright_role`` / ``termwright_name`` attributes.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Dict, List, Optional, Sequence
from weakref import WeakKeyDictionary

from .client import DEFAULT_CAPABILITIES, SemanticClient, client_from_env
from .roles import ROLE_SET
from .tree import Rect, SemanticNode, SemanticSnapshot, SemanticState

ADAPTER_NAME = "termwright-textual"
ADAPTER_VERSION = "0.1.0"

#: Widget class name → semantic role. Walked along the MRO, so subclasses of a
#: mapped widget inherit its role without being listed.
ROLE_BY_CLASS: Dict[str, str] = {
    # inputs
    "Button": "button",
    "Input": "textbox",
    "MaskedInput": "textbox",
    "TextArea": "textbox",
    "Checkbox": "checkbox",
    "Switch": "checkbox",
    "RadioButton": "radio",
    "ToggleButton": "checkbox",
    # collections
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
    # output
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
    # structure
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


def role_for(widget: Any) -> str:
    """Resolve a widget's semantic role: explicit attribute, then class MRO."""
    override = getattr(widget, "termwright_role", None)
    if isinstance(override, str) and override in ROLE_SET:
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
        text = getattr(candidate, "plain", None)
        if isinstance(text, str) and text:
            return text
        try:
            rendered = str(candidate)
        except Exception:  # pragma: no cover - a widget with a hostile __str__
            continue
        if rendered and not rendered.startswith("<"):
            return rendered
    return ""


#: Roles that take their accessible name from what they contain when they
#: carry no name of their own, as ARIA's "name from content" prescribes. A
#: `ListItem` wrapping a `Label` is the common case: the item is what a test
#: addresses, but the text lives one level down.
NAME_FROM_CONTENT_ROLES = frozenset(
    {"listitem", "menuitem", "tab", "button", "checkbox", "radio", "cell", "row", "heading"}
)

#: Longest name derived from a node's contents, in characters.
MAX_CONTENT_NAME = 200


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


def test_id_for(widget: Any) -> Optional[str]:
    """Test id: the author's annotation, then Textual's own DOM id.

    Both sources are accepted and the annotation wins, so a widget whose DOM id
    is generated, reused across screens, or simply wrong for a test can be
    given a stable handle without renaming it in the CSS.
    """
    annotated = getattr(widget, "termwright_test_id", None)
    if isinstance(annotated, str) and annotated:
        return annotated
    native = getattr(widget, "id", None)
    return native if isinstance(native, str) and native else None


def name_for(widget: Any, role: Optional[str] = None) -> str:
    """Accessible name: explicit attribute, then own text, then contents, then id.

    ``role`` decides whether the contents are consulted; pass it for a node
    whose role names from content, or leave it out to skip that step.
    """
    override = getattr(widget, "termwright_name", None)
    if isinstance(override, str):
        return override

    own = _first_text(
        getattr(widget, "label", None),
        getattr(widget, "placeholder", None),
        # `content` is where Static (and so Label) keeps its text; `renderable`
        # is the same thing on older Textual versions.
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


def _state_for(widget: Any, app: Any, visible: bool) -> Optional[SemanticState]:
    focused = app.focused is widget
    disabled = bool(getattr(widget, "disabled", False))
    checked: Optional[bool] = None
    if role_for(widget) in ("checkbox", "radio"):
        value = getattr(widget, "value", None)
        if isinstance(value, bool):
            checked = value
    expanded = getattr(widget, "collapsed", None)
    multiline = True if type(widget).__name__ == "TextArea" else None
    readonly = getattr(widget, "read_only", None)

    state = SemanticState(
        # Nothing off-screen holds the focus, whatever the app still points at.
        focused=True if focused and visible else None,
        disabled=True if disabled else None,
        hidden=None if visible else True,
        checked=checked,
        expanded=(not expanded) if isinstance(expanded, bool) else None,
        multiline=multiline,
        readonly=True if readonly is True else None,
    )
    return state if state.to_wire() else None


def _value_for(widget: Any, role: str) -> Optional[str]:
    """Current value of a value-bearing widget, as text."""
    if role not in ("textbox", "progressbar"):
        return None
    value = getattr(widget, "text", None) if role == "textbox" else None
    if not isinstance(value, str):
        value = getattr(widget, "value", None)
    if isinstance(value, bool) or value is None:
        return None
    return value if isinstance(value, str) else str(value)


def _actions_for(role: str) -> Optional[Sequence[str]]:
    if role in ("button", "menuitem", "tab"):
        return ("focus", "activate")
    if role in ("checkbox", "radio"):
        return ("focus", "toggle")
    if role == "textbox":
        return ("focus", "setValue")
    if role in ("list", "table"):
        return ("focus", "scroll", "select")
    return None


class TextualSemantics:
    """Live semantic session bound to one Textual app."""

    def __init__(self, app: Any, client: SemanticClient) -> None:
        self._app = app
        self._client = client
        self._ids: "WeakKeyDictionary[Any, str]" = WeakKeyDictionary()
        self._next_id = 0
        self._starting = False
        self._started = False

    @property
    def client(self) -> SemanticClient:
        """The underlying protocol client (session id, revision, limits)."""
        return self._client

    # -- tree building -----------------------------------------------------

    def _node_id(self, widget: Any) -> str:
        existing = self._ids.get(widget)
        if existing is not None:
            return existing
        self._next_id += 1
        assigned = f"w{self._next_id}"
        self._ids[widget] = assigned
        return assigned

    def build_snapshot(self) -> SemanticSnapshot:
        """Read the current DOM into a snapshot. Pure: it changes no app state."""
        app = self._app
        screen = app.screen
        size = app.size
        columns = max(1, int(size.width))
        rows = max(1, int(size.height))

        widgets: List[Any] = [screen]
        widgets.extend(screen.query("*"))

        included = {id(widget): widget for widget in widgets}
        nodes: List[SemanticNode] = []
        root_ids: List[str] = []

        for widget in widgets:
            role = role_for(widget)
            visible = bool(getattr(widget, "display", True)) and bool(getattr(widget, "visible", True))
            bounds = self._bounds_for(widget, columns, rows) if visible else None

            parent_id: Optional[str] = None
            parent = getattr(widget, "parent", None)
            while parent is not None and id(parent) not in included:
                parent = getattr(parent, "parent", None)
            if parent is not None and parent is not widget:
                parent_id = self._node_id(parent)

            node_id = self._node_id(widget)
            if parent_id is None:
                root_ids.append(node_id)

            nodes.append(
                SemanticNode(
                    id=node_id,
                    parentId=parent_id,
                    role=role,
                    # The screen's own `name` is Textual's internal "_default";
                    # the app's title is what a test would look for.
                    name=self._app_name() if widget is screen else name_for(widget, role),
                    testId=test_id_for(widget),
                    value=_value_for(widget, role),
                    bounds=bounds,
                    state=_state_for(widget, app, visible),
                    actions=_actions_for(role),
                    frameworkType=type(widget).__name__ if role == "generic" else None,
                )
            )

        return SemanticSnapshot(
            sessionId=self._client.session_id or "pending",
            revision=self._client.revision + 1,
            columns=columns,
            rows=rows,
            rootIds=root_ids,
            nodes=nodes,
        )

    def _app_name(self) -> str:
        """Name for the root node: the app's title, else its class name."""
        title = getattr(self._app, "title", None)
        if isinstance(title, str) and title:
            return title
        return type(self._app).__name__

    @staticmethod
    def _bounds_for(widget: Any, columns: int, rows: int) -> Optional[Rect]:
        """Absolute screen bounds, or None when the widget is not composited."""
        try:
            region = widget.region
        except Exception:
            return None
        width = int(getattr(region, "width", 0))
        height = int(getattr(region, "height", 0))
        column = int(getattr(region, "x", 0))
        row = int(getattr(region, "y", 0))
        if width <= 0 or height <= 0:
            return None
        if column >= columns or row >= rows or column + width <= 0 or row + height <= 0:
            return None
        return Rect(row=row, column=column, width=width, height=height)

    # -- publishing --------------------------------------------------------

    def publish(self) -> None:
        """Publish the current tree and write the marker. Never raises."""
        if not self._client.connected:
            return
        try:
            marker = self._client.publish_nowait(self.build_snapshot())
        except Exception:
            # A broken adapter must not break the app under test.
            return
        if marker:
            self._write(marker)

    def _write(self, text: str) -> None:
        driver = getattr(self._app, "_driver", None)
        if driver is not None and hasattr(driver, "write"):
            try:
                driver.write(text)
                driver.flush()
                return
            except Exception:
                pass
        stream = sys.__stdout__ or sys.stdout
        stream.write(text)
        stream.flush()

    def on_display(self) -> None:
        """Hook body: start the session on first display, publish afterwards."""
        if self._client.closed:
            return
        if not self._started:
            if not self._starting:
                self._starting = True
                asyncio.ensure_future(self._start_and_publish())
            return
        self.publish()

    async def start(self, timeout: float = 5.0) -> bool:
        """Complete the handshake. Called for you on the first display."""
        self._starting = True
        self._started = await self._client.start(timeout)
        return self._started

    async def _start_and_publish(self) -> None:
        if await self.start():
            self.publish()

    async def close(self) -> None:
        """Close the side-channel."""
        await self._client.close()


def enable_semantics(
    app: Any,
    *,
    adapter_name: str = ADAPTER_NAME,
    adapter_version: str = ADAPTER_VERSION,
    capabilities: Sequence[str] = DEFAULT_CAPABILITIES,
    env: Optional[Dict[str, str]] = None,
) -> Optional[TextualSemantics]:
    """Publish ``app``'s widget tree to the termwright driver, if one is attached.

    :returns: The live session, or ``None`` when the app is running without a
        driver — the dormant case, in which nothing at all is installed.
    """
    existing = getattr(app, "_termwright_semantics", None)
    if isinstance(existing, TextualSemantics):
        return existing

    client = client_from_env(
        adapter_name=adapter_name,
        adapter_version=adapter_version,
        capabilities=capabilities,
        env=env,
    )
    if client is None:
        return None

    semantics = TextualSemantics(app, client)
    app._termwright_semantics = semantics

    original = app.post_display_hook

    def post_display_hook() -> None:
        original()
        semantics.on_display()

    # An instance attribute shadows the class method Textual calls after flush.
    app.post_display_hook = post_display_hook
    return semantics


class TermwrightApp:
    """Mixin enabling semantics on mount: ``class MyApp(TermwrightApp, App)``.

    Dormant without the driver env, exactly like :func:`enable_semantics`.
    """

    def on_mount(self) -> None:
        enable_semantics(self)
