"""asyncio client for the semantic side-channel.

**Dormant rule.** Without ``TERMWRIGHT_ENDPOINT`` and ``TERMWRIGHT_TOKEN`` in
the environment, :func:`client_from_env` returns ``None`` and the application
opens no socket, writes no marker, and renders exactly the bytes it would have
rendered anyway. Instrumentation is something the driver switches on, never
something the app does on its own.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import OrderedDict
from typing import Any, Dict, Mapping, MutableMapping, Optional, Sequence

from .errors import ProtocolViolation, TermwrightError
from .framing import FrameDecoder, encode_frame
from .limits import DEFAULT_LIMITS, ProtocolLimits
from .marker import encode_marker
from .diffing import build_delta
from .logs import LogRecord, flatten_attrs, validate_log_record
from .messages import (
    PROTOCOL_ID,
    get_tree_result,
    hello,
    log_message,
    parse_driver_message,
    protocol_error,
    revision_commit,
    snapshot_message,
)
from .tree import SemanticSnapshot
from .validate import validate_snapshot

ENV_ENDPOINT = "TERMWRIGHT_ENDPOINT"
ENV_TOKEN = "TERMWRIGHT_TOKEN"
ENV_PROTOCOL = "TERMWRIGHT_PROTOCOL"

DEFAULT_CAPABILITIES = (
    "tree",
    "bounds",
    "absolute-bounds",
    "states",
    "actions",
    "render-revisions",
)

#: Capabilities for an adapter that also forwards application logs. Announcing
#: `logs` is what makes the driver send a budget back; without it the driver
#: sends none and the adapter must stay silent.
CAPABILITIES_WITH_LOGS = DEFAULT_CAPABILITIES + ("logs",)

#: How many recent snapshots stay answerable by a ``get-tree`` for a past revision.
_SNAPSHOT_HISTORY = 8


def _is_pipe_path(endpoint: str) -> bool:
    """Whether the endpoint names a Windows pipe rather than a unix socket."""
    return endpoint.startswith("\\\\.\\pipe\\") or endpoint.startswith("\\\\?\\pipe\\")


async def _open_connection(endpoint: str):
    """Open the driver's endpoint on whichever transport it needs.

    The driver listens on a unix socket everywhere but Windows, where it
    listens on a named pipe (``\\\\.\\pipe\\termwright-<hex>``). asyncio reaches a
    pipe only through the proactor loop's ``create_pipe_connection``, and does
    not expose ``open_unix_connection`` on Windows at all — so choosing by the
    endpoint's shape is what keeps one client working on both.
    """
    loop = asyncio.get_event_loop()
    if _is_pipe_path(endpoint):
        connect = getattr(loop, "create_pipe_connection", None)
        if connect is None:
            # A pipe path under a loop that cannot open one: nothing to do but
            # stay silent, which the caller treats as no side channel.
            raise NotImplementedError("this event loop cannot open a named pipe")
        reader = asyncio.StreamReader(loop=loop)
        protocol = asyncio.StreamReaderProtocol(reader, loop=loop)
        transport, _ = await connect(lambda: protocol, endpoint)
        writer = asyncio.StreamWriter(transport, protocol, reader, loop)
        return reader, writer
    return await asyncio.open_unix_connection(endpoint)


class _TokenBucket:
    """Rate limiter for the log channel: `burst` capacity, refilled per second.

    The adapter enforces its own budget and drops locally, which is what keeps
    a log storm from eating the frame budget the semantic tree needs.
    """

    def __init__(self, per_second: int, burst: int, now: float) -> None:
        self._per_second = max(0, per_second)
        self._capacity = float(max(0, burst) + max(0, per_second))
        self._tokens = self._capacity
        self._updated = now

    def take(self, now: float) -> bool:
        """Consume one token, refilling first. False means "over budget"."""
        if self._per_second <= 0:
            return False
        elapsed = max(0.0, now - self._updated)
        self._updated = now
        self._tokens = min(self._capacity, self._tokens + elapsed * self._per_second)
        if self._tokens < 1.0:
            return False
        self._tokens -= 1.0
        return True


class SemanticClient:
    """One semantic session: handshake, snapshot publishing, render markers.

    The client owns the revision counter. :meth:`publish` allocates the next
    revision, sends the snapshot and its commit, and returns the marker string
    the caller must write to stdout **after** the render's last byte.
    """

    def __init__(
        self,
        endpoint: str,
        token: str,
        *,
        adapter_name: str,
        adapter_version: str,
        capabilities: Sequence[str] = DEFAULT_CAPABILITIES,
        limits: ProtocolLimits = DEFAULT_LIMITS,
    ) -> None:
        self._endpoint = endpoint
        self._token = token
        self._adapter_name = adapter_name
        self._adapter_version = adapter_version
        self._capabilities = tuple(capabilities)
        self._limits = limits

        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._decoder = FrameDecoder(limits.maxFrameBytes, limits.maxDepth)
        self._reader_task: Optional[asyncio.Task] = None
        self._ready: Optional[asyncio.Future] = None
        self._history: MutableMapping[int, Dict[str, Any]] = OrderedDict()
        #: The last tree the driver has, which every delta is based on.
        self._published: Optional[Dict[str, Any]] = None
        #: Counters a test or a diagnostic can read.
        self.deltas_sent = 0
        self.snapshots_sent = 0

        self.session_id: Optional[str] = None
        self.revision = 0
        self.marker_enabled = False
        #: Log-channel budget from ``hello-ack``; ``None`` means logs are off.
        self.log_budget: Optional[Dict[str, Any]] = None
        self._log_seq = 0
        self._log_bucket: Optional[_TokenBucket] = None
        #: Records dropped locally for being over budget or over a limit.
        self.logs_dropped = 0
        self.subscribe = "snapshots"
        self.closed = False

    # -- lifecycle ---------------------------------------------------------

    @property
    def connected(self) -> bool:
        """True once the driver has acknowledged the handshake."""
        return self.session_id is not None and not self.closed

    async def start(self, timeout: float = 5.0) -> bool:
        """Connect, send ``hello`` and wait for ``hello-ack``.

        :returns: ``True`` on a completed handshake. Returns ``False`` — never
            raises — when the endpoint is unreachable or the driver rejects us:
            a failed side-channel must not take the application down with it.
        """
        try:
            self._reader, self._writer = await asyncio.wait_for(
                _open_connection(self._endpoint), timeout
            )
        except (OSError, asyncio.TimeoutError, NotImplementedError, AttributeError):
            # AttributeError belongs here: `asyncio.open_unix_connection` does
            # not exist on Windows at all, so a wrong transport choice raises
            # rather than failing to connect, and that must not reach the app.
            self.closed = True
            return False

        loop = asyncio.get_event_loop()
        self._ready = loop.create_future()
        self._reader_task = asyncio.ensure_future(self._read_loop())

        try:
            await self._send(
                hello(self._token, self._adapter_name, self._adapter_version, self._capabilities)
            )
            await asyncio.wait_for(asyncio.shield(self._ready), timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError, OSError, TermwrightError):
            await self.close()
            return False
        return self.session_id is not None

    async def close(self) -> None:
        """Close the channel. Safe to call more than once."""
        self.closed = True
        if self._reader_task is not None:
            self._reader_task.cancel()
            self._reader_task = None
        writer, self._writer = self._writer, None
        if writer is not None:
            try:
                writer.close()
            except OSError:
                pass
        self._reader = None

    # -- publishing --------------------------------------------------------

    def prepare(self, snapshot: SemanticSnapshot) -> Optional[Dict[str, Any]]:
        """Allocate the next revision and return the validated wire snapshot.

        Synchronous on purpose: the caller emits the marker for this revision
        immediately after the render's last byte, so the revision number cannot
        wait on a socket write.

        The snapshot's ``sessionId``/``revision`` are overwritten with the
        session's own — an adapter never picks its own revision numbers.

        :raises ProtocolViolation: If the snapshot fails validation. That is an
            adapter bug, not hostile input, so it is loud rather than silent.
        """
        if not self.connected or self._writer is None or self.session_id is None:
            return None

        self.revision += 1
        wire = snapshot.to_wire()
        wire["sessionId"] = self.session_id
        wire["revision"] = self.revision

        result = validate_snapshot(wire, self._limits)
        if not result.ok:
            self.revision -= 1
            raise ProtocolViolation("snapshot-invalid", f"{result.code}: {result.detail}")

        self._remember(self.revision, wire)
        return wire

    async def publish(self, snapshot: SemanticSnapshot) -> Optional[str]:
        """Send a snapshot for the next revision and return its marker sequence.

        :returns: The DCS marker to write to stdout after the render, or
            ``None`` when the session is not (or no longer) live.
        """
        wire = self.prepare(snapshot)
        if wire is None:
            return None
        await self._send_snapshot(wire)
        return self.marker(wire["revision"])

    def publish_nowait(self, snapshot: SemanticSnapshot) -> Optional[str]:
        """Same as :meth:`publish`, but the frames are sent on a background task.

        The marker comes back at once so it can follow the render immediately;
        the frames still reach the driver in revision order, because each task
        writes to the transport before its first suspension point.
        """
        wire = self.prepare(snapshot)
        if wire is None:
            return None
        asyncio.ensure_future(self._send_snapshot(wire))
        return self.marker(wire["revision"])

    async def _send_snapshot(self, wire: Dict[str, Any]) -> None:
        if self.subscribe != "revisions":
            await self._send(self._tree_message(wire))
        await self._send(revision_commit(wire["revision"]))

    def _tree_message(self, wire: Dict[str, Any]) -> Dict[str, Any]:
        """A delta when the driver asked for one and it is worth sending.

        Falls back to the whole tree on the first publish, when the driver
        wants snapshots, and whenever the delta would carry more than about
        half the tree — past that a patch costs more than the thing it
        replaces. The base is only advanced once a message is built from it,
        so a skipped publish cannot leave the driver applying a delta onto a
        tree it never received.
        """
        delta = None
        if self.subscribe == "diffs" and self._published is not None:
            delta = build_delta(self._published, wire)

        self._published = wire
        if delta is None:
            self.snapshots_sent += 1
            return snapshot_message(wire)
        self.deltas_sent += 1
        return delta

    def log(
        self,
        level: str,
        message: str,
        *,
        attrs: Optional[Mapping[str, Any]] = None,
        logger: Optional[str] = None,
        ts: Optional[int] = None,
    ) -> bool:
        """Forward one application log record, if the driver asked for logs.

        Returns whether the record went out. A record is dropped when the
        session is not live, when the driver granted no budget, when this
        adapter is over its rate, or when the record breaks a limit.

        Every attempt consumes a sequence number, dropped or not: the gap left
        in ``seq`` is precisely how the driver learns records were lost here
        rather than in transit.
        """
        if not self.connected or self._log_bucket is None:
            return False

        self._log_seq += 1
        record = LogRecord(
            ts=int(time.time() * 1000) if ts is None else ts,
            level=level,
            message=message,
            seq=self._log_seq,
            attrs=flatten_attrs(attrs) if attrs else None,
            logger=logger,
            revision=self.revision or None,
        )

        if not self._log_bucket.take(time.monotonic()):
            self.logs_dropped += 1
            return False

        wire = record.to_wire()
        result = validate_log_record(wire, self._limits)
        if not result.ok:
            # An oversized or malformed record is dropped locally rather than
            # taking the channel down; the gap in seq reports it.
            self.logs_dropped += 1
            return False

        asyncio.ensure_future(self._send(log_message(record)))
        return True

    def marker(self, revision: int) -> Optional[str]:
        """Marker sequence committing ``revision``, or ``None`` if not enabled."""
        if not self.marker_enabled or self.session_id is None:
            return None
        return encode_marker(self._token, self.session_id, revision)

    def _remember(self, revision: int, wire: Dict[str, Any]) -> None:
        self._history[revision] = wire
        while len(self._history) > _SNAPSHOT_HISTORY:
            self._history.pop(next(iter(self._history)))

    async def _send(self, message: Mapping[str, Any]) -> None:
        writer = self._writer
        if writer is None:
            return
        writer.write(encode_frame(message, self._limits.maxFrameBytes))
        try:
            await writer.drain()
        except (OSError, ConnectionResetError):
            await self.close()

    # -- receiving ---------------------------------------------------------

    async def _read_loop(self) -> None:
        reader = self._reader
        if reader is None:
            return
        try:
            while True:
                chunk = await reader.read(64 * 1024)
                if not chunk:
                    break
                for raw in self._decoder.push(chunk):
                    await self._handle(raw)
        except (asyncio.CancelledError, ProtocolViolation, OSError):
            pass
        finally:
            if self._ready is not None and not self._ready.done():
                self._ready.set_result(False)
            self.closed = True

    async def _handle(self, raw: Any) -> None:
        parsed = parse_driver_message(raw, self._limits)
        if not parsed.ok:
            await self._send(protocol_error("malformed", parsed.detail[:512]))
            await self.close()
            return
        message = parsed.message
        assert message is not None

        if message["type"] == "hello-ack":
            self.session_id = message["sessionId"]
            self.marker_enabled = bool(message["marker"]["enabled"])
            self.log_budget = message.get("logs")
            budget = self.log_budget
            if budget is not None and budget.get("enabled"):
                self._log_bucket = _TokenBucket(
                    int(budget["maxRecordsPerSecond"]), int(budget["burst"]), time.monotonic()
                )
            else:
                self._log_bucket = None
            self.subscribe = message["subscribe"]
            self._limits = ProtocolLimits.from_wire(message["limits"])
            if self._ready is not None and not self._ready.done():
                self._ready.set_result(True)
        elif message["type"] == "get-tree":
            requested = message.get("revision", self.revision)
            held = self._history.get(requested)
            if held is None:
                await self._send(
                    get_tree_result(message["requestId"], error=f"revision {requested} is not retained")
                )
            else:
                await self._send(get_tree_result(message["requestId"], snapshot=held))
        elif message["type"] == "error":
            await self.close()


def client_from_env(
    *,
    adapter_name: str,
    adapter_version: str,
    capabilities: Sequence[str] = DEFAULT_CAPABILITIES,
    env: Optional[Mapping[str, str]] = None,
    limits: ProtocolLimits = DEFAULT_LIMITS,
) -> Optional[SemanticClient]:
    """Build a client from ``TERMWRIGHT_*``, or ``None`` when not instrumented.

    This is the dormant rule in one function: no endpoint or no token means no
    client, and the caller must then do nothing at all.
    """
    source: Mapping[str, str] = os.environ if env is None else env
    endpoint = source.get(ENV_ENDPOINT)
    token = source.get(ENV_TOKEN)
    if not endpoint or not token:
        return None
    protocol = source.get(ENV_PROTOCOL)
    if protocol is not None and protocol not in ("", PROTOCOL_ID, "1"):
        return None
    return SemanticClient(
        endpoint,
        token,
        adapter_name=adapter_name,
        adapter_version=adapter_version,
        capabilities=capabilities,
        limits=limits,
    )
