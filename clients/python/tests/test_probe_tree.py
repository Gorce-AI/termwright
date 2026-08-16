"""The tree the Textual probe builds, and the three things it gets right.

Each of these is a claim the hand-written adapter could not make: bounds that
are what the user can see, paint order taken from Textual's own compositor,
and a distinction between "not displayed" and "scrolled out of view".
"""

from __future__ import annotations

import pytest

pytest.importorskip("textual", reason="the probe needs Textual to observe")

from textual.app import App, ComposeResult  # noqa: E402
from textual.containers import Vertical, VerticalScroll  # noqa: E402
from textual.widget import Widget  # noqa: E402
from textual.widgets import Button, Input, Label  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright_probe.textual_tree import (  # noqa: E402
    Identities,
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


class WeatherGlyph(Widget):
    """A widget the role map has never heard of."""


class CustomApp(App):
    def compose(self) -> ComposeResult:
        yield WeatherGlyph()


async def snapshot_of(app: App, *, size=(80, 24)) -> dict:
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        return build_snapshot(
            app, Identities(), session_id="s-test", revision=1
        ).to_wire()


def by_test_id(snapshot: dict) -> dict:
    return {node.get("testId"): node for node in snapshot["nodes"]}


# -- the tree is a legal tree ----------------------------------------------


async def test_the_snapshot_validates():
    snapshot = await snapshot_of(DemoApp())
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"


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


# -- bounds are what the user can see --------------------------------------


async def test_bounds_are_the_visible_rectangle_not_the_region():
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
        rows = [item for item in observe(app) if type(item.widget).__name__ == "Label"]
        clipped = [
            item
            for item in rows
            if item.geometry is not None
            and item.geometry.region.height > 0
            and item.geometry.visible_region.height == 0
        ]
        assert clipped, "the fixture no longer scrolls anything out of view"

        snapshot = build_snapshot(
            app, Identities(), session_id="s", revision=1
        ).to_wire()

    # No published rectangle may claim rows outside the 10-row viewport.
    for node in snapshot["nodes"]:
        bounds = node.get("bounds")
        if bounds is None or node.get("state", {}).get("hidden"):
            continue
        assert bounds["row"] + bounds["height"] <= 10 + 1, node
        assert bounds["width"] > 0 and bounds["height"] > 0, node
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
        undisplayed = build_snapshot(app, Identities(), session_id="s", revision=1).to_wire()
    gone = by_test_id(undisplayed)["gone"]
    assert gone["state"]["hidden"] is True
    assert "offscreen" not in gone["state"], (
        "a widget that was never laid out is not scrolled away"
    )
    assert "bounds" not in gone, "a widget Textual is not displaying has no rectangle"

    app = ScrollingApp()
    async with app.run_test(size=(40, 10)) as pilot:
        await pilot.pause()
        scrolled = build_snapshot(app, Identities(), session_id="s", revision=1).to_wire()
    clipped = [
        node
        for node in scrolled["nodes"]
        if node.get("state", {}).get("hidden") and "bounds" in node
    ]
    assert clipped, "nothing was reported as on-screen-but-clipped"
    assert all(node["bounds"]["width"] == 0 for node in clipped)
    assert all(node["state"].get("offscreen") is True for node in clipped), (
        "a clipped node did not say why it is hidden"
    )
    assert validate_snapshot(scrolled, DEFAULT_LIMITS).ok


# -- paint order, and the occlusion claim it earns -------------------------


async def test_paint_order_comes_from_textuals_own_compositor():
    app = DemoApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        observations = observe(app)
        ranked = [item for item in observations if item.paint_order is not None]
        assert len(ranked) == len(
            [item for item in observations if item.geometry is not None]
        ), "some widget with geometry went unranked"

        # The ranking must agree with the key the compositor sorts by, which is
        # the only thing that makes it Textual's answer rather than ours.
        in_rank_order = sorted(ranked, key=lambda item: item.paint_order)
        keys = [item.geometry.order for item in in_rank_order]
        assert keys == sorted(keys)


async def test_every_node_claims_occlusion_when_paint_order_is_known():
    """Which is what opens the driver's pointer gate for Textual."""
    snapshot = await snapshot_of(DemoApp())
    claims = {node.get("occlusion") for node in snapshot["nodes"]}
    assert claims == {"known"}, claims


# -- identity ---------------------------------------------------------------


async def test_identity_survives_between_frames():
    app = DemoApp()
    identities = Identities()
    async with app.run_test() as pilot:
        await pilot.pause()
        first = build_snapshot(app, identities, session_id="s", revision=1).to_wire()
        await pilot.pause()
        second = build_snapshot(app, identities, session_id="s", revision=2).to_wire()

    def ids(snapshot):
        return {node["testId"]: node["id"] for node in snapshot["nodes"] if node.get("testId")}

    assert ids(first) == ids(second), "node ids moved between frames"


async def test_provenance_says_the_framework_reported_it():
    snapshot = await snapshot_of(DemoApp())
    assert all(node.get("p") == "framework" for node in snapshot["nodes"])


async def test_an_annotation_is_marked_as_the_authors():
    class AnnotatedApp(App):
        def compose(self) -> ComposeResult:
            label = Label("raw", id="thing")
            label.termwright_name = "Disk almost full"
            yield label

    snapshot = await snapshot_of(AnnotatedApp())
    annotated = by_test_id(snapshot)["thing"]
    assert annotated["name"] == "Disk almost full"
    assert annotated["px"] == {"name": "annotation"}
    assert annotated["p"] == "framework"
