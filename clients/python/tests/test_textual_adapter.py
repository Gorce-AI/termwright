"""Textual adapter: dormant by default, publishes a real tree when driven."""

from __future__ import annotations

import pytest

pytest.importorskip("textual", reason="the Textual adapter needs textual installed")

from textual.app import App, ComposeResult  # noqa: E402
from textual.containers import Vertical  # noqa: E402
from textual.widgets import Button, Input, Label  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright.client import ENV_ENDPOINT, ENV_TOKEN  # noqa: E402
from termwright.textual_adapter import (  # noqa: E402
    TextualSemantics,
    enable_semantics,
    name_for,
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
