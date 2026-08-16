"""An instrumented Textual app publishing to a driver, end to end in-process.

The child-process proof lives in `test_probe_bootstrap.py`; this is the other
half — that once attached, the probe completes a handshake that declares what
it can observe, and publishes trees the driver can validate.
"""

from __future__ import annotations

import asyncio

import pytest

pytest.importorskip("textual", reason="the probe needs Textual")

from textual.app import App, ComposeResult  # noqa: E402
from textual.containers import Vertical  # noqa: E402
from textual.widgets import Button, Input, Label  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright.client import SemanticClient  # noqa: E402
from termwright_probe.session import PROBE_CAPABILITIES, ProbeSession, probe_info  # noqa: E402

from test_client import FakeDriver, TOKEN  # noqa: E402


class DemoApp(App):
    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve")
            yield Input(placeholder="Reason", id="reason")


async def wait_for(predicate, *, timeout: float = 3.0) -> None:
    """Poll until `predicate()` or the budget runs out."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("timed out waiting for the probe")


# -- what the probe says about itself ---------------------------------------


def test_probe_info_claims_only_what_textual_gives():
    info = probe_info("8.2.8")
    assert info["framework"] == "textual"
    assert info["identityKind"] == "stable", "Textual has a retained DOM"
    assert info["frameworkVersion"] == "8.2.8"
    assert set(info["capabilities"]) == set(PROBE_CAPABILITIES)


def test_frame_begin_is_not_claimed():
    """post_display_hook runs after the flush, so there is no frame start.

    A consumer reading "no frame-begin" as "no frame in progress" would hang;
    claiming a signal we cannot send would be worse.
    """
    assert "frame-begin" not in probe_info()["capabilities"]


# -- the handshake ----------------------------------------------------------


async def test_the_handshake_carries_the_probe_declaration(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    app = DemoApp()
    async with app.run_test() as pilot:
        client = SemanticClient(
            endpoint,
            TOKEN,
            adapter_name="textual-probe",
            adapter_version="0.1.0",
            probe=probe_info("8.2.8"),
        )
        session = ProbeSession(app, client)
        session.on_frame()  # starts the handshake
        await wait_for(lambda: driver.hello is not None)
        await pilot.pause()
        await client.close()

    assert driver.hello is not None
    declared = driver.hello.get("probe")
    assert declared is not None, "the driver cannot tell this is a probe"
    assert declared["framework"] == "textual"
    assert declared["identityKind"] == "stable"


# -- publishing -------------------------------------------------------------


async def test_it_publishes_a_valid_tree_for_a_real_app(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    app = DemoApp()
    async with app.run_test() as pilot:
        client = SemanticClient(
            endpoint,
            TOKEN,
            adapter_name="textual-probe",
            adapter_version="0.1.0",
            probe=probe_info(),
        )
        session = ProbeSession(app, client)
        session.on_frame()
        await wait_for(lambda: client.connected)
        session.on_frame()
        await wait_for(
            lambda: any(m.get("type") == "snapshot" for m in driver.received)
        )
        await pilot.pause()
        await client.close()

    published = [m for m in driver.received if m.get("type") == "snapshot"]
    assert published, "nothing reached the driver"
    snapshot = published[-1]["snapshot"]
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"

    roles = {node["role"] for node in snapshot["nodes"]}
    assert {"button", "textbox", "text"} <= roles, roles
    assert all(node.get("occlusion") == "known" for node in snapshot["nodes"])


async def test_frames_before_the_handshake_are_counted_not_queued(endpoint):
    """A dropped frame is a fact worth having; a stale queued one is not.

    The next publish carries the current tree, which is newer than anything a
    queue could have held — so the drop costs nothing but is still counted.
    """
    driver = FakeDriver(endpoint)
    await driver.start()
    app = DemoApp()
    async with app.run_test() as pilot:
        client = SemanticClient(
            endpoint, TOKEN, adapter_name="textual-probe", adapter_version="0.1.0"
        )
        session = ProbeSession(app, client)
        session.on_frame()
        session.on_frame()
        session.on_frame()
        assert session.frames_dropped >= 2
        await wait_for(lambda: client.connected)
        await pilot.pause()
        await client.close()


async def test_a_dropped_frame_never_leaves_the_driver_holding_a_gap(endpoint):
    """The delta base is the last tree SENT, not the last tree built.

    A probe that skips frames must not then send a patch against a tree the
    driver never received. The client only advances its base when it builds a
    message from it, and this is the test that says so out loud.
    """
    driver = FakeDriver(endpoint, subscribe="diffs")
    await driver.start()
    app = DemoApp()
    async with app.run_test() as pilot:
        client = SemanticClient(
            endpoint, TOKEN, adapter_name="textual-probe", adapter_version="0.1.0"
        )
        session = ProbeSession(app, client)
        session.on_frame()
        await wait_for(lambda: client.connected)

        session.on_frame()
        await wait_for(lambda: any(m.get("type") == "snapshot" for m in driver.received))

        # Change the tree while the session cannot publish, so the frame is
        # dropped rather than sent.
        app.query_one("#prompt", Label).update("Permission granted")
        await pilot.pause()
        client.closed = True
        session.on_frame()
        client.closed = False

        session.on_frame()
        await wait_for(lambda: len(driver.received) > 2)
        await pilot.pause()
        await client.close()

    trees = [m for m in driver.received if m.get("type") in ("snapshot", "tree-delta")]
    assert trees, "nothing reached the driver"
    # Without a delta this test proves nothing, and it would go on passing.
    assert any(m["type"] == "tree-delta" for m in trees), (
        f"no delta was produced, so the base-revision check is vacuous: "
        f"{[m['type'] for m in trees]}"
    )
    # The first tree is always whole; any later delta must be based on the
    # revision of a tree the driver actually saw.
    seen_revisions = {
        m["snapshot"]["revision"] if m["type"] == "snapshot" else m["revision"]
        for m in trees
    }
    for message in trees:
        if message["type"] == "tree-delta":
            assert message["baseRevision"] in seen_revisions, (
                f"delta based on r{message['baseRevision']}, "
                f"which the driver never received: {sorted(seen_revisions)}"
            )


async def test_a_broken_session_never_reaches_the_application(endpoint):
    """The application owns the terminal and the exit code."""
    app = DemoApp()
    async with app.run_test() as pilot:
        client = SemanticClient(
            str(endpoint) + "-does-not-exist",
            TOKEN,
            adapter_name="textual-probe",
            adapter_version="0.1.0",
        )
        session = ProbeSession(app, client)
        for _ in range(3):
            session.on_frame()  # must not raise
        await pilot.pause()
        await client.close()
    assert session.frames_dropped >= 3


# -- the definition of done, in one test ------------------------------------


async def test_a_vanilla_app_in_a_child_process_publishes_a_tree(endpoint, tmp_path):
    """Zero-config, end to end: no import of ours anywhere in the application.

    An ordinary Textual app is launched in a child interpreter with nothing but
    environment variables, and a real socket on this side receives a validated
    semantic tree with the widgets the app composed. This is the whole claim of
    Phase 3; everything else in these files is a component of it.
    """
    import os
    import sys as _sys
    from pathlib import Path

    from termwright_probe import write_bootstrap

    fixture = Path(__file__).parent / "fixtures" / "vanilla_textual_app.py"
    src = str(Path(__file__).resolve().parents[1] / "src")

    driver = FakeDriver(endpoint)
    await driver.start()

    with write_bootstrap(package_root=src) as bootstrap:
        env = bootstrap.env(
            {
                **os.environ,
                "TERMWRIGHT_ENDPOINT": endpoint,
                "TERMWRIGHT_TOKEN": TOKEN,
                "TEXTUAL_DRIVER": "textual.drivers.headless_driver:HeadlessDriver",
            }
        )
        child = await asyncio.create_subprocess_exec(
            _sys.executable,
            str(fixture),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await wait_for(
                lambda: any(m.get("type") == "snapshot" for m in driver.received),
                timeout=30.0,
            )
        finally:
            if child.returncode is None:
                child.terminate()
            await child.wait()

    published = [m for m in driver.received if m.get("type") == "snapshot"]
    assert published, "the child published nothing"
    snapshot = published[-1]["snapshot"]
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"

    names = {node["name"] for node in snapshot["nodes"]}
    assert "Approve" in names, names
    assert "Permission required" in names, names
    roles = {node["role"] for node in snapshot["nodes"]}
    assert {"button", "textbox", "text"} <= roles, roles

    assert driver.hello is not None
    assert driver.hello.get("probe", {}).get("framework") == "textual"
