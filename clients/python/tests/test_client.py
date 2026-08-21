"""Client behaviour: the dormant rule, the handshake, and publishing."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any, Dict, List, Optional

import pytest
from conftest import geometry

from termwright import (
    DEFAULT_LIMITS,
    MARKER_OSC_CODE,
    NodeGeometryObservations,
    Observation,
    PROTOCOL_ID,
    SemanticClient,
    client_from_env,
    verify_marker_payload,
    framework_evidence,
)
from termwright.client import ENV_ENDPOINT, ENV_TOKEN
from termwright.framing import FrameDecoder, encode_frame
from termwright.tree import Rect, SemanticNode, SemanticSnapshot

TOKEN = "test-token"
SESSION = "s-42"

#: `OSC 8487;` — what precedes a marker payload on the wire.
OSC_INTRODUCER = f"\x1b]{MARKER_OSC_CODE};"


def payload_of(marker: str) -> str:
    """The payload a VT parser would hand an OSC handler.

    Only the introducer is stripped: `verify_marker_payload` tolerates the
    trailing terminator, and leaving it on exercises that tolerance.
    """
    assert marker.startswith(OSC_INTRODUCER), marker
    return marker[len(OSC_INTRODUCER) :]


def sample_snapshot() -> SemanticSnapshot:
    return SemanticSnapshot(
        sessionId="ignored",
        revision=999,
        columns=80,
        rows=24,
        rootIds=["root"],
        nodes=[
            SemanticNode(id="root", role="dialog", name="Permission", geometry=geometry(Rect(0, 0, 40, 2))),
            SemanticNode(
                id="ok",
                parentId="root",
                role="button",
                name="Approve",
                geometry=geometry(Rect(1, 2, 9, 1)),
                actions=("focus", "activate"),
            ),
        ],
        coordinateSpace=Observation("known", "viewport-cells", evidence=framework_evidence("python-test")),
        hitGrid=Observation("unsupported", capability="pointer-hit-grid", reason="framework-unobservable"),
    )


class FakeDriver:
    """Minimal driver end: completes the handshake, records adapter frames."""

    def __init__(
        self,
        path: str,
        logs: Optional[Dict[str, Any]] = None,
        subscribe: str = "snapshots",
    ) -> None:
        self.path = path
        self.logs = logs
        self.subscribe = subscribe
        self.received: List[Dict[str, Any]] = []
        self._server: Optional[asyncio.AbstractServer] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self.hello: Optional[Dict[str, Any]] = None
        self.frame_arrived = asyncio.Event()

    async def start(self) -> None:
        self._server = await asyncio.start_unix_server(self._serve, self.path)

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._writer = writer
        decoder = FrameDecoder(DEFAULT_LIMITS.maxFrameBytes, DEFAULT_LIMITS.maxDepth)
        try:
            while True:
                chunk = await reader.read(64 * 1024)
                if not chunk:
                    return
                for message in decoder.push(chunk):
                    if message.get("type") == "hello":
                        self.hello = message
                        ack: Dict[str, Any] = {
                            "type": "hello-ack",
                            "protocol": PROTOCOL_ID,
                            "sessionId": SESSION,
                            "limits": DEFAULT_LIMITS.to_wire(),
                            "subscribe": self.subscribe,
                            "marker": {"enabled": True},
                        }
                        # Absent unless the test asks for it: no budget means
                        # the adapter must not log at all.
                        if self.logs is not None:
                            ack["logs"] = self.logs
                        await self.send(ack)
                    else:
                        self.received.append(message)
                        self.frame_arrived.set()
        finally:
            # `Server.wait_closed()` hangs until every transport is closed.
            writer.close()

    async def send(self, message: Dict[str, Any]) -> None:
        assert self._writer is not None
        self._writer.write(encode_frame(message, DEFAULT_LIMITS.maxFrameBytes))
        await self._writer.drain()

    async def wait_for(self, count: int, timeout: float = 2.0) -> None:
        async def poll() -> None:
            while len(self.received) < count:
                self.frame_arrived.clear()
                await self.frame_arrived.wait()

        await asyncio.wait_for(poll(), timeout)

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()


# -- dormant rule ----------------------------------------------------------


@pytest.mark.parametrize(
    "env",
    [
        {},
        {ENV_ENDPOINT: "/tmp/nope.sock"},
        {ENV_TOKEN: TOKEN},
        {ENV_ENDPOINT: "", ENV_TOKEN: TOKEN},
        {ENV_ENDPOINT: "/tmp/nope.sock", ENV_TOKEN: ""},
    ],
)
def test_no_client_without_a_complete_environment(env):
    assert client_from_env(adapter_name="test", adapter_version="0.1.0", env=env) is None


def test_client_is_created_when_instrumented(endpoint):
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.1.0",
        env={ENV_ENDPOINT: endpoint, ENV_TOKEN: TOKEN},
    )
    assert isinstance(client, SemanticClient)
    assert not client.connected


async def test_an_unreachable_endpoint_fails_soft(endpoint):
    client = SemanticClient(endpoint, TOKEN, adapter_name="test", adapter_version="0.1.0")
    assert await client.start(timeout=1.0) is False
    assert client.publish_nowait(sample_snapshot()) is None
    await client.close()


# -- handshake and publishing ---------------------------------------------


async def test_handshake_and_publish(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")

    assert await client.start(timeout=2.0) is True
    assert client.session_id == SESSION
    assert driver.hello is not None
    assert driver.hello["token"] == TOKEN
    assert driver.hello["adapter"] == {"name": "pytest", "version": "0.1.0"}

    marker = await client.publish(sample_snapshot())
    await driver.wait_for(2)

    snapshot_frame, commit_frame = driver.received[0], driver.received[1]
    assert snapshot_frame["type"] == "snapshot"
    assert snapshot_frame["snapshot"]["sessionId"] == SESSION
    assert snapshot_frame["snapshot"]["revision"] == 1
    assert commit_frame == {"type": "revision-commit", "revision": 1}

    assert marker is not None
    verified = verify_marker_payload(payload_of(marker), TOKEN, SESSION)
    assert verified is not None and verified.revision == 1

    await client.close()
    await driver.close()


async def test_revisions_increase_by_one_per_publish(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")
    assert await client.start(timeout=2.0) is True

    for expected in (1, 2, 3):
        marker = client.publish_nowait(sample_snapshot())
        assert marker is not None
        assert verify_marker_payload(payload_of(marker), TOKEN, SESSION).revision == expected

    await driver.wait_for(6)
    commits = [frame["revision"] for frame in driver.received if frame["type"] == "revision-commit"]
    assert commits == [1, 2, 3]

    await client.close()
    await driver.close()


async def test_nowait_oversize_has_no_marker_and_recovers():
    """A locally unframeable tree emits no marker and rolls back its revision."""

    class RecordingWriter:
        def __init__(self) -> None:
            self.frames: List[bytes] = []

        def write(self, frame: bytes) -> None:
            self.frames.append(bytes(frame))

        async def drain(self) -> None:
            pass

    limits = replace(DEFAULT_LIMITS, maxFrameBytes=1024)
    client = SemanticClient(
        "unused",
        TOKEN,
        adapter_name="pytest",
        adapter_version="0.1.0",
        limits=limits,
    )
    writer = RecordingWriter()
    client._writer = writer
    client.session_id = SESSION
    client.marker_enabled = True
    many_nodes = [
        SemanticNode(id="n0", role="text", name="x" * 1000, p="framework", geometry=geometry())
    ] + [
        SemanticNode(id=f"n{index}", role="text", name=str(index), p="framework", geometry=geometry())
        for index in range(1, 21)
    ]
    oversized = SemanticSnapshot(
        sessionId="ignored",
        revision=0,
        columns=80,
        rows=24,
        rootIds=[node.id for node in many_nodes],
        nodes=many_nodes,
        coordinateSpace=Observation("known", "viewport-cells", evidence=framework_evidence("python-test")),
        hitGrid=Observation("unsupported", capability="pointer-hit-grid", reason="framework-unobservable"),
    )

    assert client.publish_nowait(oversized) is None
    assert writer.frames == []
    assert client.connected
    assert client.revision == 0

    recovered = SemanticSnapshot(
        sessionId="ignored",
        revision=0,
        columns=80,
        rows=24,
        rootIds=["n0"],
        nodes=[SemanticNode(id="n0", role="text", name="x", p="framework", geometry=geometry())],
        coordinateSpace=Observation("known", "viewport-cells", evidence=framework_evidence("python-test")),
        hitGrid=Observation("unsupported", capability="pointer-hit-grid", reason="framework-unobservable"),
    )
    marker = client.publish_nowait(recovered)
    assert marker is not None
    verified = verify_marker_payload(payload_of(marker), TOKEN, SESSION)
    assert verified is not None and verified.revision == 1

    decoder = FrameDecoder(limits.maxFrameBytes, limits.maxDepth)
    messages = [message for frame in writer.frames for message in decoder.push(frame)]
    assert [message["type"] for message in messages] == ["snapshot", "revision-commit"]
    assert messages[0]["snapshot"]["revision"] == 1
    assert messages[1]["revision"] == 1
    assert client.connected


async def test_a_revisions_subscription_gets_commits_only(endpoint):
    driver = FakeDriver(endpoint, subscribe="revisions")
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")
    assert await client.start(timeout=2.0) is True

    await client.publish(sample_snapshot())
    await driver.wait_for(1)

    kinds = [frame["type"] for frame in driver.received]
    assert kinds == ["revision-commit"], kinds

    await client.close()
    await driver.close()


# -- transport selection ---------------------------------------------------


def test_the_endpoint_shape_picks_the_transport():
    """The driver hands out a pipe on Windows and a unix socket elsewhere."""
    from termwright.client import _is_pipe_path

    assert _is_pipe_path(r"\\.\pipe\termwright-abc")
    assert _is_pipe_path(r"\\?\pipe\termwright-abc")
    assert not _is_pipe_path("/tmp/termwright/semantic.sock")


def test_a_pipe_endpoint_is_a_client_not_a_dormant_case(endpoint):
    """A pipe path is a real endpoint; whether it can be opened is the
    transport's business, not the constructor's."""
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.1.0",
        env={ENV_ENDPOINT: r"\\.\pipe\termwright-abc", ENV_TOKEN: TOKEN},
    )
    assert isinstance(client, SemanticClient)


async def test_a_pipe_endpoint_on_a_loop_that_cannot_open_one_fails_soft():
    """On POSIX there is no proactor loop, so the connect must fail quietly.

    The app has to keep rendering: a side channel that cannot be opened is not
    an error the application should ever see.
    """
    client = SemanticClient(
        r"\\.\pipe\termwright-abc", TOKEN, adapter_name="test", adapter_version="0.1.0"
    )
    assert await client.start(timeout=1.0) is False
    assert client.publish_nowait(sample_snapshot()) is None
    await client.close()


# -- a driver that stops reading -------------------------------------------


async def test_a_write_to_a_stalled_driver_is_bounded(endpoint):
    """A driver that stops reading must not queue frames without limit.

    asyncio keeps the loop turning, so this does not freeze a render the way
    the blocking clients would — but an unbounded `drain` holds every frame in
    memory for as long as the driver stays away, and the session never notices
    it has stopped working.
    """
    import asyncio as _asyncio

    stalled = _asyncio.Event()

    async def serve(reader, writer):
        await reader.read(65536)
        ack = {
            "type": "hello-ack",
            "protocol": PROTOCOL_ID,
            "sessionId": SESSION,
            "limits": DEFAULT_LIMITS.to_wire(),
            "subscribe": "snapshots",
            "marker": {"enabled": True},
        }
        writer.write(encode_frame(ack, DEFAULT_LIMITS.maxFrameBytes))
        await writer.drain()
        await stalled.wait()  # and then read nothing at all
        writer.close()

    server = await asyncio.start_unix_server(serve, endpoint)
    client = SemanticClient(
        endpoint,
        TOKEN,
        adapter_name="test",
        adapter_version="0.1.0",
        write_timeout=0.1,
    )
    assert await client.start()

    padding = "x" * 4000
    started = asyncio.get_event_loop().time()
    for revision in range(400):
        if not client.connected:
            break
        snapshot = SemanticSnapshot(
            sessionId="s",
            revision=revision,
            columns=80,
            rows=24,
            rootIds=["root"],
            nodes=[SemanticNode(id="root", role="dialog", name="Permission", geometry=geometry())]
            + [
                SemanticNode(id=f"n{index}", parentId="root", role="text", name=padding, geometry=geometry())
                for index in range(60)
            ],
            coordinateSpace=Observation("known", "viewport-cells", evidence=framework_evidence("python-test")),
            hitGrid=Observation("unsupported", capability="pointer-hit-grid", reason="framework-unobservable"),
        )
        await client.publish(snapshot)
    elapsed = asyncio.get_event_loop().time() - started

    stalled.set()
    server.close()

    assert elapsed < 30, f"publishing took {elapsed:.1f}s; the write was not bounded"
    # A partially written frame cannot be resynchronised, so the session ends
    # rather than retrying into a stream the driver can no longer parse.
    assert not client.connected, "the session survived a stalled driver"
    await client.close()
