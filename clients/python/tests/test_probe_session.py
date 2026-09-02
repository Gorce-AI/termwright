"""An instrumented Textual app publishing to a driver, end to end in-process.

The child-process proof lives in `test_probe_bootstrap.py`; this is the other
half — that once attached, the probe completes a handshake that declares what
it can observe, and publishes trees the driver can validate.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("textual", reason="the probe needs Textual")

from textual.app import App, ComposeResult  # noqa: E402
from textual.containers import Vertical  # noqa: E402
from textual.widgets import Button, Input, Label  # noqa: E402

from termwright import DEFAULT_LIMITS, validate_snapshot  # noqa: E402
from termwright.client import SemanticClient  # noqa: E402
from termwright_probe.session import PROBE_CAPABILITIES, ProbeSession, probe_info  # noqa: E402
from termwright_probe.textual_probe import (  # noqa: E402
    CommittedTextualFrame,
    TextualCommitFailure,
)

from test_client import FakeDriver, TOKEN  # noqa: E402


class DemoApp(App):
    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve")
            yield Input(placeholder="Reason", id="reason")


def commit_for(app: App) -> CommittedTextualFrame:
    driver = app._driver
    return CommittedTextualFrame(
        app=app,
        screen=app.screen,
        driver=driver,
        preflight_marker=lambda: None,
        enqueue_marker=driver.write,
    )


class UnitClient:
    def __init__(self, marker="marker"):
        self.connected = True
        self.session_id = "unit"
        self.revision = 0
        self.marker = marker
        self.published = []
        self.failures = []

    def publish_nowait(self, snapshot):
        self.published.append(snapshot)
        self.revision += 1
        return self.marker

    def fail_nowait(self, code, message):
        self.failures.append((code, message))


class GatedClient(UnitClient):
    def __init__(self):
        super().__init__()
        self.connected = False
        self.start_entered = asyncio.Event()
        self.allow_start = asyncio.Event()
        self.failed = asyncio.Event()

    async def start(self):
        self.start_entered.set()
        await self.allow_start.wait()
        self.connected = True
        return True

    def fail_nowait(self, code, message):
        super().fail_nowait(code, message)
        self.failed.set()


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
    assert info["instrumentation"] == {
        "highestTier": "T3",
        "semanticClass": "A",
        "degradedCapabilities": ["inactive-screen-tree"],
    }


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
        session.on_frame(commit_for(app))  # starts the handshake
        await wait_for(lambda: driver.hello is not None)
        await pilot.pause()
        await client.close()

    assert driver.hello is not None
    declared = driver.hello.get("probe")
    assert declared is not None, "the driver cannot tell this is a probe"
    assert declared["framework"] == "textual"
    assert declared["identityKind"] == "stable"
    assert declared["instrumentation"] == {
        "highestTier": "T3",
        "semanticClass": "A",
        "degradedCapabilities": ["inactive-screen-tree"],
    }


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
        session.on_frame(commit_for(app))
        await wait_for(lambda: client.connected)
        session.on_frame(commit_for(app))
        await wait_for(
            lambda: any(m.get("type") == "semantic-full" for m in driver.received)
        )
        await pilot.pause()
        await client.close()

    published = [m for m in driver.received if m.get("type") == "semantic-full"]
    assert published, "nothing reached the driver"
    snapshot = published[-1]["snapshot"]
    result = validate_snapshot(snapshot, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"

    roles = {node["role"] for node in snapshot["nodes"]}
    assert {"button", "textbox", "text"} <= roles, roles
    assert all("geometry" in node for node in snapshot["nodes"])
    assert snapshot["hitGrid"]["status"] == "known"


async def test_frames_before_the_handshake_are_dropped_and_refresh_requests_a_fresh_one(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    app = DemoApp()
    async with app.run_test() as pilot:
        client = SemanticClient(
            endpoint, TOKEN, adapter_name="textual-probe", adapter_version="0.1.0"
        )
        session = ProbeSession(app, client)
        session.on_frame(commit_for(app))
        session.on_frame(commit_for(app))
        session.on_frame(commit_for(app))
        assert session.frames_dropped >= 2
        await wait_for(lambda: client.connected)
        assert client.snapshots_sent == 0
        session.on_frame(commit_for(app))
        await wait_for(lambda: client.snapshots_sent == 1)
        await pilot.pause()
        await client.close()


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
            session.on_frame(commit_for(app))  # must not raise
        await pilot.pause()
        await client.close()
    assert session.frames_dropped >= 3


def test_marker_uses_captured_writer_even_if_app_driver_changes(monkeypatch):
    app = SimpleNamespace(_driver=None)
    client = UnitClient()
    session = ProbeSession(app, client)
    session._started = True
    monkeypatch.setattr(session, "_snapshot", lambda _commit: object())
    first = []
    second = []
    commit = CommittedTextualFrame(app, object(), object(), lambda: None, first.append)
    app._driver = SimpleNamespace(
        write=second.append, flush=lambda: second.append("flush")
    )

    session.on_frame(commit)

    assert first == ["marker"]
    assert second == []


def test_marker_failure_is_fatal_and_has_no_fallback(monkeypatch):
    app = SimpleNamespace(_driver=None)
    client = UnitClient()
    session = ProbeSession(app, client)
    session._started = True
    monkeypatch.setattr(session, "_snapshot", lambda _commit: object())

    def broken_write(_text):
        raise OSError("closed writer")

    commit = CommittedTextualFrame(app, object(), object(), lambda: None, broken_write)
    session.on_frame(commit)

    assert client.failures == [
        (
            "adapter-guarantee-violation",
            "Textual commit marker write failed: OSError: closed writer",
        )
    ]


async def test_handshake_discards_old_frame_and_requests_new_refresh(monkeypatch):
    refreshed = asyncio.Event()
    app = SimpleNamespace(refresh=refreshed.set)
    client = GatedClient()
    session = ProbeSession(app, client)
    monkeypatch.setattr(session, "_snapshot", lambda _commit: object())
    writes = []
    commit = CommittedTextualFrame(app, object(), object(), lambda: None, writes.append)

    session.on_frame(commit)
    await client.start_entered.wait()
    session.on_frame(commit)
    assert client.published == []
    client.allow_start.set()
    await refreshed.wait()
    assert client.published == []

    session.on_frame(commit)

    assert len(client.published) == 1
    assert writes == ["marker"]


async def test_failed_post_handshake_refresh_fails_closed():
    def broken_refresh():
        raise RuntimeError("refresh rejected")

    app = SimpleNamespace(refresh=broken_refresh)
    client = GatedClient()
    session = ProbeSession(app, client)
    commit = CommittedTextualFrame(
        app, object(), object(), lambda: None, lambda _text: None
    )

    session.on_frame(commit)
    await client.start_entered.wait()
    client.allow_start.set()
    await client.failed.wait()

    assert client.failures == [
        (
            "adapter-guarantee-violation",
            "Textual refresh after handshake failed: RuntimeError: refresh rejected",
        )
    ]


def test_typed_commit_failure_precedes_snapshot_build_and_publication(monkeypatch):
    app = SimpleNamespace(refresh=lambda: None)
    client = UnitClient()
    session = ProbeSession(app, client)
    session._started = True
    built = []
    monkeypatch.setattr(session, "_snapshot", lambda _commit: built.append(True))

    session.on_frame(TextualCommitFailure(app, "certified writer disappeared"))

    assert built == []
    assert client.published == []
    assert client.failures == [
        ("adapter-guarantee-violation", "certified writer disappeared")
    ]


def test_marker_preflight_failure_precedes_snapshot_publication(monkeypatch):
    app = SimpleNamespace()
    client = UnitClient()
    session = ProbeSession(app, client)
    session._started = True
    built = []

    def full():
        raise RuntimeError("queue full")

    monkeypatch.setattr(session, "_snapshot", lambda _commit: built.append(True))
    commit = CommittedTextualFrame(app, object(), object(), full, lambda _text: None)

    session.on_frame(commit)

    assert built == []
    assert client.published == []
    assert client.failures == [
        (
            "adapter-guarantee-violation",
            "Textual commit marker preflight failed: RuntimeError: queue full",
        )
    ]


@pytest.mark.parametrize("capacity", [1, 2, 64])
def test_queue_full_race_after_publication_fails_channel_with_detail(monkeypatch, capacity):
    from queue import Queue

    app = SimpleNamespace()
    client = UnitClient()
    session = ProbeSession(app, client)
    session._started = True
    monkeypatch.setattr(session, "_snapshot", lambda _commit: object())

    queue = Queue(maxsize=capacity)

    def preflight():
        assert not queue.full()

    def raced_full(text):
        # Deterministically model another producer claiming every remaining
        # slot after preflight but before this marker's non-blocking enqueue.
        for index in range(capacity):
            queue.put_nowait(f"racer-{index}")
        queue.put_nowait(text)

    commit = CommittedTextualFrame(app, object(), object(), preflight, raced_full)
    session.on_frame(commit)

    assert len(client.published) == 1
    assert client.failures == [
        (
            "adapter-guarantee-violation",
            "Textual WriterThread queue became full after snapshot publication",
        )
    ]


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
                lambda: any(m.get("type") == "semantic-full" for m in driver.received),
                timeout=30.0,
            )
        finally:
            if child.returncode is None:
                child.terminate()
            await child.wait()

    published = [m for m in driver.received if m.get("type") == "semantic-full"]
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
