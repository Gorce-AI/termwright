"""Client behaviour: the dormant rule, the handshake, and publishing."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pytest

from termwright import (
    DEFAULT_LIMITS,
    MARKER_OSC_CODE,
    SemanticClient,
    client_from_env,
    verify_marker_payload,
)
from termwright.client import ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN
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
            SemanticNode(id="root", role="dialog", name="Permission", bounds=Rect(0, 0, 40, 2)),
            SemanticNode(
                id="ok",
                parentId="root",
                role="button",
                name="Approve",
                bounds=Rect(1, 2, 9, 1),
                actions=("focus", "activate"),
            ),
        ],
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
                            "protocol": "termwright/1",
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
        {ENV_ENDPOINT: "/tmp/nope.sock", ENV_TOKEN: TOKEN, ENV_PROTOCOL: "termwright/9"},
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


async def test_get_tree_is_answered_from_the_retained_snapshots(endpoint):
    driver = FakeDriver(endpoint)
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")
    assert await client.start(timeout=2.0) is True

    await client.publish(sample_snapshot())
    await driver.wait_for(2)

    await driver.send({"type": "get-tree", "requestId": 7, "revision": 1})
    await driver.wait_for(3)
    answer = driver.received[2]
    assert answer["type"] == "get-tree-result"
    assert answer["requestId"] == 7
    assert answer["snapshot"]["revision"] == 1

    await driver.send({"type": "get-tree", "requestId": 8, "revision": 99})
    await driver.wait_for(4)
    assert "error" in driver.received[3]

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


async def test_a_driver_asking_for_diffs_still_gets_a_tree(endpoint):
    """This client cannot produce deltas, so it answers with whole trees.

    It never announces `tree-diffs`, so a conforming driver will not ask; if
    one does anyway, a full tree is a superset of what a delta would carry.
    Publishing nothing would leave the driver with `semanticTree: true` and no
    tree — the failure mode that is hardest to diagnose from the outside.
    """
    driver = FakeDriver(endpoint, subscribe="diffs")
    await driver.start()
    client = SemanticClient(endpoint, TOKEN, adapter_name="pytest", adapter_version="0.1.0")
    assert await client.start(timeout=2.0) is True
    assert client.subscribe == "diffs"

    await client.publish(sample_snapshot())
    await driver.wait_for(2)

    kinds = [frame["type"] for frame in driver.received]
    assert "snapshot" in kinds, f"a diffs subscription produced no tree: {kinds}"
    assert "revision-commit" in kinds

    await client.close()
    await driver.close()


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
