"""The tree the Textual probe builds, and the three things it gets right.

Each of these is a claim the hand-written adapter could not make: bounds that
are what the user can see, paint order taken from Textual's own compositor,
and a distinction between "not displayed" and "scrolled out of view".
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

pytest.importorskip("textual", reason="the probe needs Textual to observe")

from textual.app import App, ComposeResult  # noqa: E402
from textual.containers import Vertical, VerticalScroll  # noqa: E402
from textual.widget import Widget  # noqa: E402
from textual.widgets import Button, Input, Label, Static  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright.textual import semantic  # noqa: E402
import termwright_probe.textual_tree as textual_tree  # noqa: E402
from termwright_probe.textual_tree import (  # noqa: E402
    Identities,
    TextualObservationError,
    build_snapshot,
    observe,
    role_for,
)


class DemoApp(App):
    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve")
            yield Button("Reject", id="reject", disabled=True)
            yield Input(placeholder="Reason", id="reason")


class PasswordApp(App):
    def compose(self) -> ComposeResult:
        yield Input(value="sentinel-secret", password=True, id="password")


class ScrollingApp(App):
    """Far more content than fits, so most of it is clipped away."""

    def compose(self) -> ComposeResult:
        with VerticalScroll():
            for index in range(60):
                yield Label(f"row {index}", id=f"row-{index}")


class HiddenApp(App):
    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("shown", id="shown")
            yield Label("gone", id="gone")

    def on_mount(self) -> None:
        self.query_one("#gone").display = False


class OverlayApp(App):
    CSS = """
    Screen { layers: base cover; }
    #target, #cover { width: 12; height: 3; }
    #target { layer: base; }
    #cover { layer: cover; }
    """

    def compose(self) -> ComposeResult:
        yield Button("Target", id="target")
        yield Static("Cover", id="cover")


class WeatherGlyph(Widget):
    """A widget the role map has never heard of."""


class CustomApp(App):
    def compose(self) -> ComposeResult:
        yield WeatherGlyph()


async def snapshot_of(app: App, *, size=(80, 24)) -> dict:
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        return build_snapshot(
            app, app.screen, Identities(), session_id="s-test", revision=1
        ).to_wire()


def by_test_id(snapshot: dict) -> dict:
    return {node.get("testId"): node for node in snapshot["nodes"]}


def test_tree_api_failures_are_not_relabelled_as_absent_data():
    class BrokenScreen:
        def query(self, _selector):
            raise RuntimeError("query contract broke")

    screen = BrokenScreen()
    app = SimpleNamespace(screen=screen)
    with pytest.raises(TextualObservationError, match="Screen.query failed"):
        observe(app, screen)


def test_malformed_non_absent_geometry_fails_closed():
    with pytest.raises(TextualObservationError, match="malformed geometry"):
        textual_tree._rect(SimpleNamespace(x="not-an-int", y=0, width=1, height=1))


def test_missing_pointer_api_fails_closed():
    screen = SimpleNamespace(size=SimpleNamespace(width=1, height=1))
    with pytest.raises(TextualObservationError, match="get_widget_at is unavailable"):
        textual_tree._hit_regions(screen, [], Identities(), {})


# -- the tree is a legal tree ----------------------------------------------


async def test_the_snapshot_validates():
    snapshot = await snapshot_of(DemoApp())
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"


async def test_textual_values_are_observations_and_passwords_are_withheld():
    public = by_test_id(await snapshot_of(DemoApp()))["reason"]["value"]
    assert public["status"] == "known"
    assert public["sensitivity"] == "public"

    password = by_test_id(await snapshot_of(PasswordApp()))["password"]["value"]
    assert password == {
        "status": "withheld",
        "reason": "sensitive",
        "sensitivity": "sensitive",
    }
    assert "sentinel-secret" not in str(password)


async def test_roles_come_from_the_class_ancestry():
    snapshot = await snapshot_of(DemoApp())
    nodes = by_test_id(snapshot)
    assert nodes["approve"]["role"] == "button"
    assert nodes["reason"]["role"] == "textbox"
    assert nodes["prompt"]["role"] == "text"


def test_a_subclass_inherits_its_role_without_registration():
    """`SaveButton(Button)` is a button because Python already says so."""

    class SaveButton(Button):
        pass

    assert role_for(SaveButton("Save")) == "button"


async def test_an_unrecognised_widget_names_its_own_type():
    snapshot = await snapshot_of(CustomApp())
    generic = [node for node in snapshot["nodes"] if node["role"] == "generic"]
    assert generic, "the fixture no longer produces a generic node"
    assert "WeatherGlyph" in {node.get("frameworkType") for node in generic}
    assert validate_snapshot(snapshot, DEFAULT_LIMITS).ok


# -- geometry is what the framework observed ------------------------------


async def test_visible_rect_is_clipped_to_the_viewport():
    """The audit's finding, and the reason this probe exists at all.

    In a scrolling container most rows sit outside the viewport. `region`
    reports where they would be; only `visible_region` — Textual's own
    `clip ∩ region` — reports what is on screen. Publishing the former means
    handing a test coordinates for cells nobody can see.
    """
    app = ScrollingApp()
    async with app.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        screen = app.screen
        rows = [item for item in observe(app, screen) if type(item.widget).__name__ == "Label"]
        clipped = [
            item
            for item in rows
            if item.geometry is not None
            and item.geometry.region.height > 0
            and item.geometry.visible_region.height == 0
        ]
        assert clipped, "the fixture no longer scrolls anything out of view"

        snapshot = build_snapshot(
            app, app.screen, Identities(), session_id="s", revision=1
        ).to_wire()

    # No published rectangle may claim rows outside the 10-row viewport.
    for node in snapshot["nodes"]:
        visible = node["geometry"]["visibleRect"]
        if visible["status"] != "known":
            continue
        rect = visible["value"]
        if rect["height"] > 0:
            assert rect["row"] + rect["height"] <= 10 + 1, node
    assert validate_snapshot(snapshot, DEFAULT_LIMITS).ok


async def test_a_mounted_widget_missing_from_the_committed_layout_is_authoritatively_absent(monkeypatch):
    app = DemoApp()
    async with app.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        original_observe = textual_tree.observe

        def without_input_layout(current_app, current_screen):
            observations = original_observe(current_app, current_screen)
            for item in observations:
                if getattr(item.widget, "id", None) == "reason":
                    item.geometry = None
            return observations

        monkeypatch.setattr(textual_tree, "observe", without_input_layout)
        snapshot = build_snapshot(app, app.screen, Identities(), session_id="s", revision=1).to_wire()

    reason = by_test_id(snapshot)["reason"]
    assert reason["geometry"]["intendedRect"]["status"] == "absent"
    assert reason["geometry"]["intendedRect"]["reason"] == "not-laid-out"
    assert reason["geometry"]["visibleRect"]["status"] == "absent"
    assert reason["geometry"]["visibleRect"]["reason"] == "not-laid-out"
    assert validate_snapshot(snapshot, DEFAULT_LIMITS).ok


async def test_clipped_away_and_not_displayed_are_told_apart():
    """`state.offscreen` says which kind of hidden this is.

    Not displayed is hidden with no bounds at all. Displayed but entirely
    clipped is hidden *and* offscreen, with a zero-area rectangle at its own
    origin — "it is somewhere, and none of it is on screen". The earlier
    encoding leaned on absent bounds to mean "not displayed", which collides
    with what absent bounds already means for a producer that cannot report
    geometry at all.
    """
    app = HiddenApp()
    async with app.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        undisplayed = build_snapshot(app, app.screen, Identities(), session_id="s", revision=1).to_wire()
    gone = by_test_id(undisplayed)["gone"]
    assert gone["state"]["hidden"] is True
    assert "offscreen" not in gone["state"], (
        "a widget that was never laid out is not scrolled away"
    )
    assert gone["geometry"]["visibleRect"] == {
        "status": "absent", "reason": "not-displayed",
        "evidence": {"source": "framework", "method": "native", "strength": "authoritative", "providerId": "textual-compositor"},
    }

    app = ScrollingApp()
    async with app.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        scrolled = build_snapshot(app, app.screen, Identities(), session_id="s", revision=1).to_wire()
    clipped = [
        node
        for node in scrolled["nodes"]
        if node["geometry"]["displayed"].get("value") is True
        and node["geometry"]["visibleRect"].get("status") == "known"
        and node["geometry"]["visibleRect"]["value"]["height"] == 0
    ]
    assert clipped, "nothing was reported as on-screen-but-clipped"
    assert all(node["state"].get("offscreen") is True for node in clipped), (
        "a clipped node did not say why it is hidden"
    )
    assert validate_snapshot(scrolled, DEFAULT_LIMITS).ok


# -- paint order, and the occlusion claim it earns -------------------------


async def test_paint_order_comes_from_textuals_own_compositor():
    app = DemoApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        observations = observe(app, app.screen)
        ranked = [item for item in observations if item.paint_order is not None]
        assert len(ranked) == len(
            [item for item in observations if item.geometry is not None]
        ), "some widget with geometry went unranked"

        # The ranking must agree with the key the compositor sorts by, which is
        # the only thing that makes it Textual's answer rather than ours.
        in_rank_order = sorted(ranked, key=lambda item: item.paint_order)
        keys = [item.geometry.order for item in in_rank_order]
        assert keys == sorted(keys)


async def test_publishes_qualified_geometry_and_exact_hit_grid():
    app = DemoApp()
    async with app.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        snapshot = build_snapshot(app, app.screen, Identities(), session_id="s", revision=1).to_wire()
    assert snapshot["v"] == 2
    assert snapshot["coordinateSpace"]["value"] == "viewport-cells"
    assert snapshot["hitGrid"]["status"] == "known"
    approve = by_test_id(snapshot)["approve"]
    assert "bounds" not in approve and "occlusion" not in approve
    assert approve["geometry"]["displayed"]["value"] is True
    assert approve["geometry"]["intendedRect"]["status"] == "known"
    assert approve["geometry"]["visibleRect"]["status"] == "known"
    assert any(region["recipientId"] == approve["id"] for region in snapshot["hitGrid"]["value"]["regions"])
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"


async def test_distinguishes_hidden_from_fully_clipped():
    hidden = HiddenApp()
    async with hidden.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        hidden_snapshot = build_snapshot(hidden, hidden.screen, Identities(), session_id="s", revision=1).to_wire()
    gone = by_test_id(hidden_snapshot)["gone"]["geometry"]
    assert gone["displayed"] == {
        "status": "known",
        "value": False,
        "evidence": {
            "source": "framework",
            "method": "native",
            "strength": "authoritative",
            "providerId": "textual-probe",
        },
    }
    assert gone["visibleRect"] == {
        "status": "absent", "reason": "not-displayed",
        "evidence": {"source": "framework", "method": "native", "strength": "authoritative", "providerId": "textual-compositor"},
    }

    scrolling = ScrollingApp()
    async with scrolling.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        clipped_snapshot = build_snapshot(scrolling, scrolling.screen, Identities(), session_id="s", revision=1).to_wire()
    clipped = [
        node for node in clipped_snapshot["nodes"]
        if node["geometry"]["displayed"].get("value") is True
        and node["geometry"]["visibleRect"].get("status") == "known"
        and node["geometry"]["visibleRect"]["value"]["height"] == 0
        and node["geometry"]["intendedRect"].get("status") == "known"
        and node["geometry"]["intendedRect"]["value"]["height"] > 0
    ]
    assert clipped, "no displayed-but-fully-clipped widget was qualified"


async def test_hit_grid_names_the_cover_not_the_covered_target():
    app = OverlayApp()
    async with app.run_test(size=(30, 8)) as pilot:
        await pilot.pause()
        snapshot = build_snapshot(app, app.screen, Identities(), session_id="s", revision=1).to_wire()

    nodes = by_test_id(snapshot)
    target = nodes["target"]
    cover = nodes["cover"]
    rect = target["geometry"]["intendedRect"]["value"]
    point = {
        "row": rect["row"] + rect["height"] // 2,
        "column": rect["column"] + rect["width"] // 2,
    }
    owners = [
        region["recipientId"]
        for region in snapshot["hitGrid"]["value"]["regions"]
        if region["rect"]["row"] <= point["row"] < region["rect"]["row"] + region["rect"]["height"]
        and region["rect"]["column"] <= point["column"] < region["rect"]["column"] + region["rect"]["width"]
    ]
    assert owners == [cover["id"]]
    assert target["id"] != cover["id"]


# -- identity ---------------------------------------------------------------


async def test_identity_survives_between_frames():
    app = DemoApp()
    identities = Identities()
    async with app.run_test() as pilot:
        await pilot.pause()
        first = build_snapshot(app, app.screen, identities, session_id="s", revision=1).to_wire()
        await pilot.pause()
        second = build_snapshot(app, app.screen, identities, session_id="s", revision=2).to_wire()

    def ids(snapshot):
        return {node["testId"]: node["id"] for node in snapshot["nodes"] if node.get("testId")}

    assert ids(first) == ids(second), "node ids moved between frames"


async def test_provenance_says_the_framework_reported_it():
    snapshot = await snapshot_of(DemoApp())
    assert all(node.get("p") == "framework" for node in snapshot["nodes"])


async def test_an_annotation_is_marked_as_the_authors():
    @semantic(name="Disk almost full")
    class DiskLabel(Label):
        pass

    class AnnotatedApp(App):
        def compose(self) -> ComposeResult:
            yield DiskLabel("raw", id="thing")

    snapshot = await snapshot_of(AnnotatedApp())
    annotated = by_test_id(snapshot)["thing"]
    assert annotated["name"] == "Disk almost full"
    assert annotated["px"] == {"name": "annotation"}
    assert annotated["p"] == "framework"
