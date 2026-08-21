"""The optional Textual SDK enriches intent and never owns physical facts."""

from __future__ import annotations

import inspect

import pytest

pytest.importorskip("textual", reason="the annotation integration needs Textual")

from textual.app import App, ComposeResult  # noqa: E402
from textual.widget import Widget  # noqa: E402
from textual.widgets import Label  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright.textual import annotate, remove_annotation, semantic  # noqa: E402
from termwright_probe.textual_tree import (  # noqa: E402
    DuplicateSemanticKeyError,
    Identities,
    build_snapshot,
)


@semantic(
    role="button",
    name=lambda widget: f"Deploy {widget.environment}",
    description="Deploy the selected release",
    test_id="deploy",
    extended=lambda widget: {"environment": widget.environment, "attempt": 2},
    labelled_by=lambda widget: widget.app.query_one("#deployment-label"),
    described_by=lambda widget: widget.app.query_one("#deployment-label"),
    actions=("focus", "activate"),
    key=lambda widget: f"deployment:{widget.environment}",
)
class DeploymentWidget(Widget):
    can_focus = True

    def __init__(self, environment: str) -> None:
        super().__init__()
        self.environment = environment


class AnnotatedApp(App):
    def compose(self) -> ComposeResult:
        yield Label("Production deployment", id="deployment-label")
        yield DeploymentWidget("production")


async def test_custom_widget_merges_intent_with_observed_geometry_and_focus():
    app = AnnotatedApp()
    async with app.run_test(size=(60, 12)) as pilot:
        widget = app.query_one(DeploymentWidget)
        widget.focus()
        await pilot.pause()
        snapshot = build_snapshot(app, Identities(), session_id="sdk", revision=1).to_wire()

    node = next(item for item in snapshot["nodes"] if item.get("testId") == "deploy")
    label = next(
        item for item in snapshot["nodes"] if item.get("testId") == "deployment-label"
    )

    assert node["id"] == "k:deployment:production"
    assert node["role"] == "button"
    assert node["name"] == "Deploy production"
    assert node["description"] == "Deploy the selected release"
    assert node["extended"] == {"attempt": 2, "environment": "production"}
    assert node["labelledBy"] == [label["id"]]
    assert node["describedBy"] == [label["id"]]
    assert node["state"]["focused"] is True
    assert node["geometry"]["visibleRect"]["value"]["width"] > 0
    assert node["actions"] == ["focus", "activate"]
    assert node["p"] == "framework"
    assert node["px"] == {
        "description": "annotation",
        "actions": "annotation",
        "describedBy": "annotation",
        "extended": "annotation",
        "id": "annotation",
        "labelledBy": "annotation",
        "name": "annotation",
        "role": "annotation",
        "testId": "annotation",
    }
    assert validate_snapshot(snapshot, DEFAULT_LIMITS).ok


async def test_semantic_key_survives_widget_recreation():
    identities = Identities()
    ids = []
    for _ in range(2):
        app = AnnotatedApp()
        async with app.run_test() as pilot:
            await pilot.pause()
            snapshot = build_snapshot(app, identities, session_id="sdk", revision=1).to_wire()
        ids.append(next(item["id"] for item in snapshot["nodes"] if item.get("testId") == "deploy"))
    assert ids == ["k:deployment:production", "k:deployment:production"]


async def test_duplicate_semantic_keys_fail_closed():
    @semantic(role="status", key="duplicate")
    class Duplicate(Label):
        pass

    class DuplicateApp(App):
        def compose(self) -> ComposeResult:
            yield Duplicate("one", id="one")
            yield Duplicate("two", id="two")

    async with DuplicateApp().run_test() as pilot:
        await pilot.pause()
        with pytest.raises(DuplicateSemanticKeyError, match="duplicate SemanticKey"):
            build_snapshot(pilot.app, Identities(), session_id="sdk", revision=1)


async def test_instance_annotation_supports_a_third_party_widget():
    label = Label("raw", id="vendor")
    annotate(label, role="status", name="Queue healthy", extended={"depth": 0})

    class VendorApp(App):
        def compose(self) -> ComposeResult:
            yield label

    async with VendorApp().run_test() as pilot:
        await pilot.pause()
        snapshot = build_snapshot(
            pilot.app, Identities(), session_id="sdk", revision=1
        ).to_wire()
    node = next(item for item in snapshot["nodes"] if item.get("testId") == "vendor")
    assert (node["role"], node["name"], node["extended"]) == (
        "status",
        "Queue healthy",
        {"depth": 0},
    )
    remove_annotation(label)


async def test_subclass_inherits_intent_and_can_override_one_field():
    @semantic(description="Specialized deployment")
    class SpecializedDeployment(DeploymentWidget):
        pass

    class SpecializedApp(App):
        def compose(self) -> ComposeResult:
            yield Label("Production deployment", id="deployment-label")
            yield SpecializedDeployment("staging")

    async with SpecializedApp().run_test() as pilot:
        await pilot.pause()
        snapshot = build_snapshot(
            pilot.app, Identities(), session_id="sdk", revision=1
        ).to_wire()

    node = next(item for item in snapshot["nodes"] if item.get("testId") == "deploy")
    assert node["role"] == "button"
    assert node["name"] == "Deploy staging"
    assert node["description"] == "Specialized deployment"


def test_static_unknown_role_is_rejected_at_declaration_time():
    with pytest.raises(ValueError, match="unknown semantic role"):
        semantic(role="buton")


def test_unknown_or_duplicate_actions_are_rejected():
    with pytest.raises(ValueError, match="semantic actions"):
        semantic(actions=("deploy",))
    with pytest.raises(ValueError, match="duplicates"):
        semantic(actions=("activate", "activate"))


def test_the_sdk_has_no_physical_override_parameters():
    forbidden = {"bounds", "focused", "visible", "rendered_text", "state"}
    assert forbidden.isdisjoint(inspect.signature(semantic).parameters)
    assert forbidden.isdisjoint(inspect.signature(annotate).parameters)


async def test_a_faulty_dynamic_annotation_does_not_remove_the_widget():
    @semantic(role=lambda _widget: (_ for _ in ()).throw(RuntimeError("boom")))
    class FaultyLabel(Label):
        pass

    class FaultyApp(App):
        def compose(self) -> ComposeResult:
            yield FaultyLabel("still here", id="faulty")

    async with FaultyApp().run_test() as pilot:
        await pilot.pause()
        snapshot = build_snapshot(
            pilot.app, Identities(), session_id="sdk", revision=1
        ).to_wire()
    node = next(item for item in snapshot["nodes"] if item.get("testId") == "faulty")
    assert node["role"] == "text"
    assert node["name"] == "still here"
