"""Textual adapter: dormant by default, publishes a real tree when driven."""

from __future__ import annotations

import pytest

pytest.importorskip("textual", reason="the Textual adapter needs textual installed")

from textual.app import App, ComposeResult  # noqa: E402
from textual.containers import Vertical  # noqa: E402
from textual.widgets import Button, Input, Label, ListItem, ListView  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright.client import ENV_ENDPOINT, ENV_TOKEN  # noqa: E402
from termwright.textual_adapter import (  # noqa: E402
    TextualSemantics,
    enable_semantics,
    name_for,
    name_from_content,
    role_for,
)

from test_client import FakeDriver, TOKEN  # noqa: E402


class DemoApp(App):
    """Two buttons, a label and an input — one of each interesting role."""

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve")
            yield Button("Reject", id="reject", disabled=True)
            yield Input(placeholder="Reason", id="reason")


class LabelledApp(App):
    """Explicit overrides win over the class-derived role and name."""

    def compose(self) -> ComposeResult:
        label = Label("raw", id="thing")
        label.termwright_role = "alert"
        label.termwright_name = "Disk almost full"
        yield label


# -- dormant rule ----------------------------------------------------------


async def test_dormant_without_the_driver_environment(monkeypatch):
    monkeypatch.delenv(ENV_ENDPOINT, raising=False)
    monkeypatch.delenv(ENV_TOKEN, raising=False)
    app = DemoApp()
    async with app.run_test() as pilot:
        assert enable_semantics(app) is None
        assert getattr(app, "_termwright_semantics", None) is None
        await pilot.press("tab")
        assert app.focused is not None


async def test_pilot_still_works_with_semantics_enabled(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()

    app = DemoApp()
    async with app.run_test() as pilot:
        semantics = enable_semantics(app, env={ENV_ENDPOINT: endpoint, ENV_TOKEN: TOKEN})
        assert semantics is not None
        assert await semantics.start(timeout=2.0) is True

        await pilot.press("tab")
        await pilot.pause()
        semantics.publish()
        await driver.wait_for(2)
        await semantics.close()

    frames = [frame for frame in driver.received if frame["type"] == "snapshot"]
    assert frames, "the adapter published no snapshot"
    snapshot = frames[-1]["snapshot"]
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"

    roles = {(node["role"], node["name"]) for node in snapshot["nodes"]}
    assert ("button", "Approve") in roles
    assert ("button", "Reject") in roles
    assert ("textbox", "Reason") in roles
    assert ("text", "Permission required") in roles, "a Label must be named by its text, not its id"
    assert any(role == "application" for role, _ in roles)

    by_test_id = {node.get("testId"): node for node in snapshot["nodes"]}
    assert by_test_id["reject"]["state"]["disabled"] is True
    assert by_test_id["approve"]["bounds"]["width"] > 0
    assert any(node.get("state", {}).get("focused") for node in snapshot["nodes"])

    await driver.close()


async def test_the_first_tree_arrives_without_any_interaction(endpoint):
    """An idle app must still publish: nothing may wait on a keystroke.

    Textual draws its first frame before the handshake completes and then sits
    idle, so the adapter has to publish itself once the session goes live. A
    test that pressed a key here would pass against an adapter that only ever
    publishes after the user touches the keyboard.
    """
    driver = FakeDriver(endpoint)
    await driver.start()

    app = DemoApp()
    async with app.run_test() as pilot:
        semantics = enable_semantics(app, env={ENV_ENDPOINT: endpoint, ENV_TOKEN: TOKEN})
        assert semantics is not None
        # The display hook is the only trigger; no input follows it.
        semantics.on_display()
        await driver.wait_for(2, timeout=5.0)
        await semantics.close()

    snapshots = [frame for frame in driver.received if frame["type"] == "snapshot"]
    assert snapshots, "the adapter published nothing while the app sat idle"
    names = {node["name"] for node in snapshots[0]["snapshot"]["nodes"]}
    assert "Approve" in names, f"the first tree is missing the buttons: {names}"

    await driver.close()


# -- tree shape ------------------------------------------------------------


async def test_snapshot_bounds_are_absolute_and_parented(endpoint):
    app = DemoApp()
    async with app.run_test(size=(60, 20)) as pilot:
        await pilot.pause()
        semantics = TextualSemantics(app, _offline_client(endpoint))
        snapshot = semantics.build_snapshot().to_wire()

    assert snapshot["columns"] == 60 and snapshot["rows"] == 20
    by_id = {node["id"]: node for node in snapshot["nodes"]}
    approve = next(node for node in snapshot["nodes"] if node.get("testId") == "approve")
    reject = next(node for node in snapshot["nodes"] if node.get("testId") == "reject")

    # Absolute coordinates: stacked buttons differ in row, not in parent-relative y.
    assert approve["bounds"]["row"] != reject["bounds"]["row"]
    assert by_id[approve["parentId"]]["role"] == "region"
    assert len(snapshot["rootIds"]) == 1
    assert by_id[snapshot["rootIds"][0]]["role"] == "application"


async def test_attribute_overrides_win(endpoint):
    app = LabelledApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        semantics = TextualSemantics(app, _offline_client(endpoint))
        snapshot = semantics.build_snapshot().to_wire()

    node = next(node for node in snapshot["nodes"] if node.get("testId") == "thing")
    assert node["role"] == "alert"
    assert node["name"] == "Disk almost full"


class HiddenApp(App):
    """One shown widget and one that `display = False` takes off the screen."""

    def compose(self) -> ComposeResult:
        yield Label("visible", id="shown")
        save = Button("Save", id="save")
        save.display = False
        yield save


async def test_undisplayed_widgets_are_published_as_hidden(endpoint):
    """A widget that is not on screen must say so, and must not claim focus.

    Otherwise `toBeVisible()` goes green for a control the user cannot see, and
    a stale focus flag points at something off-screen.
    """
    app = HiddenApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        semantics = TextualSemantics(app, _offline_client(endpoint))
        snapshot = semantics.build_snapshot().to_wire()

    by_test_id = {node.get("testId"): node for node in snapshot["nodes"]}

    save = by_test_id["save"]
    assert save["state"]["hidden"] is True, f"an undisplayed button published {save['state']}"
    assert "focused" not in save["state"], f"an off-screen node claims focus: {save['state']}"
    assert "bounds" not in save, "an undisplayed widget published bounds"

    shown = by_test_id["shown"]
    assert "hidden" not in (shown.get("state") or {}), "a visible widget was published as hidden"
    assert shown["bounds"]["width"] > 0


class MenuApp(App):
    """A ListView whose items keep their text in a nested Label."""

    def compose(self) -> ComposeResult:
        yield ListView(
            ListItem(Label("Open settings"), id="settings"),
            ListItem(Label("Quit"), id="quit"),
        )


async def test_listitem_takes_its_name_from_its_contents(endpoint):
    """ARIA names a listitem from what it contains, and so do we.

    A Textual ListItem holds no text of its own — the Label inside does — so
    without this `getByRole('listitem', {name})` would need a hand-written
    `termwright_name` on every row. The tview adapter already names its items
    from their text; this keeps the two frameworks addressable the same way.
    """
    app = MenuApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        semantics = TextualSemantics(app, _offline_client(endpoint))
        snapshot = semantics.build_snapshot().to_wire()

    items = {
        node["name"]: node for node in snapshot["nodes"] if node["role"] == "listitem"
    }
    assert "Open settings" in items, f"listitems were named {sorted(items)}"
    assert "Quit" in items
    # The id stays available as a test id; it is not the name any more.
    assert items["Open settings"]["testId"] == "settings"


def test_a_name_of_its_own_beats_the_contents():
    item = ListItem(Label("inner text"))
    item.termwright_name = "explicit"
    assert name_for(item, "listitem") == "explicit"


async def test_contents_are_only_consulted_for_roles_that_name_from_content():
    """The role decides whether contents count, not whether they are readable."""
    app = MenuApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        item = app.query_one("#settings", ListItem)
        container = app.query_one(ListView)

        # The same contents are readable either way…
        assert name_from_content(item) == "Open settings"
        # …but only a name-from-content role uses them.
        assert name_for(item, "listitem") == "Open settings"
        assert name_for(container, "list") == ""


async def test_a_name_from_content_joins_several_children():
    class TwoLabelApp(App):
        def compose(self) -> ComposeResult:
            yield ListView(ListItem(Label("Disk"), Label("almost full"), id="warning"))

    app = TwoLabelApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        assert name_from_content(app.query_one("#warning", ListItem)) == "Disk almost full"


def test_role_and_name_mapping_of_bare_widgets():
    assert role_for(Button("Save")) == "button"
    assert role_for(Input()) == "textbox"
    assert role_for(Label("hi")) == "text"
    assert role_for(Vertical()) == "region"
    assert name_for(Button("Save")) == "Save"
    assert name_for(Input(placeholder="Email")) == "Email"
    assert name_for(Label("Permission required")) == "Permission required"


def _offline_client(endpoint: str):
    from termwright import SemanticClient

    client = SemanticClient(endpoint, TOKEN, adapter_name="test", adapter_version="0.1.0")
    client.session_id = "s-offline"
    return client


# -- the shared adapter conventions ----------------------------------------


class AnnotatedApp(App):
    """A widget whose DOM id is wrong for tests, corrected by annotation."""

    def compose(self) -> ComposeResult:
        approve = Button("Approve", id="btn-7f3a")
        approve.termwright_test_id = "approve"
        yield approve
        yield Button("Reject", id="reject")
        yield Input(id="reason")


async def test_a_test_id_annotation_beats_the_dom_id(endpoint):
    """Rule 3: both sources are accepted, the annotation wins.

    A generated or reused DOM id is exactly the handle a test should not have
    to depend on, and renaming it in the CSS to suit a test is worse.
    """
    app = AnnotatedApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        semantics = TextualSemantics(app, _offline_client(endpoint))
        snapshot = semantics.build_snapshot().to_wire()

    ids = {node.get("testId") for node in snapshot["nodes"]}
    assert "approve" in ids, "the annotation did not reach the tree"
    assert "btn-7f3a" not in ids, "the DOM id survived alongside the annotation"
    # An unannotated widget still publishes its native id.
    assert "reject" in ids and "reason" in ids


async def test_an_empty_field_publishes_an_empty_value(endpoint):
    """Rule 5: `''` means the field is empty, absent means not value-bearing."""
    app = AnnotatedApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        semantics = TextualSemantics(app, _offline_client(endpoint))
        snapshot = semantics.build_snapshot().to_wire()

    by_test_id = {node.get("testId"): node for node in snapshot["nodes"]}
    assert by_test_id["reason"]["value"] == "", "an empty textbox lost its value"
    assert "value" not in by_test_id["approve"], "a button is not value-bearing"


def test_the_name_from_content_roles_are_exactly_the_contract_s():
    """Rule 2: the list is normative, including `row`."""
    from termwright.textual_adapter import NAME_FROM_CONTENT_ROLES

    assert NAME_FROM_CONTENT_ROLES == {
        "button", "listitem", "menuitem", "tab", "checkbox", "radio", "cell", "row", "heading",
    }
