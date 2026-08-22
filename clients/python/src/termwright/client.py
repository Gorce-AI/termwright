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
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from .debug import DebugLog, describe_endpoint
from .errors import ProtocolViolation, TermwrightError
from .evidence import (
    EvidenceProviderRegistry,
    EvidenceRevisionContext,
    FrozenEvidenceProviderRegistry,
    default_evidence_provider_registry,
)
from .framing import FrameDecoder, encode_frame
from .limits import DEFAULT_LIMITS, ProtocolLimits
from .marker import encode_marker
from .logs import LogRecord, flatten_attrs, validate_log_record
from .messages import (
    PROTOCOL_ID,
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

DEFAULT_CAPABILITIES = (
    "tree",
    "states",
    "actions",
    "render-revisions",
)

#: Capabilities for an adapter that also forwards application logs. Announcing
#: `logs` is what makes the driver send a budget back; without it the driver
#: sends none and the adapter must stay silent.
CAPABILITIES_WITH_LOGS = DEFAULT_CAPABILITIES + ("logs",)

#: Seconds a single frame write may wait for the driver to read.
#:
#: A probe publishes from the render path, so an unbounded write turns a driver
#: that stopped reading into an application that stopped drawing. asyncio keeps
#: the loop turning either way, but an unbounded ``drain`` queues frames in
#: memory for as long as the driver stays away, which is its own failure. A
#: driver that cannot take a frame in a quarter of a second is not keeping up,
#: and the next frame carries newer state anyway.
DEFAULT_WRITE_TIMEOUT = 0.25


class WriteTimeout(TermwrightError):
    """The driver did not read within the write deadline.

    Distinguishable on purpose: a caller reacting to a slow driver does
    something quite different from one whose snapshot was refused for being
    invalid, which raises :class:`ProtocolViolation` and will do so again for
    the same tree.
    """



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
        debug: Optional[DebugLog] = None,
        probe: Optional[Mapping[str, Any]] = None,
        write_timeout: float = DEFAULT_WRITE_TIMEOUT,
        evidence_registry: Optional[EvidenceProviderRegistry] = None,
    ) -> None:
        self._endpoint = endpoint
        self._token = token
        self._adapter_name = adapter_name
        self._adapter_version = adapter_version
        self._capabilities = tuple(capabilities)
        self._limits = limits
        #: Diagnostic log, or None. Every use is guarded; the client behaves
        #: identically with and without one.
        self._debug = debug
        #: What a probe says it can observe, sent with `hello`. None for a
        #: hand-written adapter, which is what the driver assumes by default.
        self._probe = probe
        #: Seconds one frame write may wait. Non-positive disables the bound,
        #: which is only sane for a caller that publishes off the render path.
        self._write_timeout = write_timeout
        self._evidence_registry = evidence_registry
        self._evidence_lease: Optional[FrozenEvidenceProviderRegistry] = None
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._decoder = FrameDecoder(limits.maxFrameBytes, limits.maxDepth)
        self._reader_task: Optional[asyncio.Task] = None
        self._ready: Optional[asyncio.Future] = None
        #: Counter a test or diagnostic can read.
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
        if self._evidence_registry is not None and self._evidence_lease is None:
            self._evidence_lease = self._evidence_registry.freeze()
        self._log("sem", f"dial {describe_endpoint(self._endpoint)} timeout={int(timeout * 1000)}ms")
        try:
            self._reader, self._writer = await asyncio.wait_for(
                _open_connection(self._endpoint), timeout
            )
        except (OSError, asyncio.TimeoutError, NotImplementedError, AttributeError) as error:
            # AttributeError belongs here: `asyncio.open_unix_connection` does
            # not exist on Windows at all, so a wrong transport choice raises
            # rather than failing to connect, and that must not reach the app.
            self._log("diag", f"dial failed, staying dormant: {_error_label(error)}")
            self.closed = True
            return False

        loop = asyncio.get_event_loop()
        self._ready = loop.create_future()
        self._reader_task = asyncio.ensure_future(self._read_loop())

        try:
            await self._send(
                hello(
                    self._token,
                    self._adapter_name,
                    self._adapter_version,
                    self._capabilities,
                    self._probe,
                    self._evidence_lease.registrations if self._evidence_lease is not None else None,
                )
            )
            self._log(
                "sem",
                f"hello sent adapter={self._adapter_name}/{self._adapter_version} "
                f"caps={','.join(self._capabilities)}",
            )
            await asyncio.wait_for(asyncio.shield(self._ready), timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError, OSError, TermwrightError) as error:
            self._log("diag", f"handshake failed, staying dormant: {_error_label(error)}")
            await self.close()
            return False
        if self.session_id is None:
            self._log("diag", "handshake ended without a session, staying dormant")
        return self.session_id is not None

    async def close(self) -> None:
        """Close the channel. Safe to call more than once."""
        if not self.closed:
            self._log(
                "sem",
                f"close r{self.revision} snapshots={self.snapshots_sent} "
                f"logs_dropped={self.logs_dropped}",
            )
        self.closed = True
        if self._evidence_lease is not None:
            self._evidence_lease.close()
            self._evidence_lease = None
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
        if self._evidence_lease is not None:
            nodes = wire.get("nodes", ())

            def resolve_recipient(recipient: Mapping[str, Any]) -> str:
                if set(recipient) == {"semanticId"} and isinstance(recipient["semanticId"], str):
                    matches = [node for node in nodes if node.get("id") == recipient["semanticId"]]
                elif set(recipient) == {"testId"} and isinstance(recipient["testId"], str):
                    matches = [node for node in nodes if node.get("testId") == recipient["testId"]]
                elif set(recipient) == {"role", "name"}:
                    matches = [
                        node for node in nodes
                        if node.get("role") == recipient["role"] and node.get("name") == recipient["name"]
                    ]
                else:
                    raise ValueError("recipient must be exactly semanticId, testId, or role+name")
                if len(matches) != 1:
                    raise ValueError(f"recipient resolved to {len(matches)} semantic nodes")
                return str(matches[0]["id"])

            wire["providerEvidence"] = list(self._evidence_lease.collect(
                EvidenceRevisionContext(
                    sessionId=self.session_id,
                    revision=self.revision,
                    columns=int(wire["columns"]),
                    rows=int(wire["rows"]),
                ),
                resolve_recipient,
            ))

        result = validate_snapshot(wire, self._limits)
        if not result.ok:
            self.revision -= 1
            raise ProtocolViolation("snapshot-invalid", f"{result.code}: {result.detail}")

        return wire

    async def publish(self, snapshot: SemanticSnapshot) -> Optional[str]:
        """Send a snapshot for the next revision and return its marker sequence.

        :returns: The OSC marker to write to stdout after the render, or
            ``None`` when the session is not (or no longer) live.
        """
        wire = self.prepare(snapshot)
        if wire is None:
            return None
        try:
            frames, sent_snapshot = self._encode_snapshot(wire)
        except ProtocolViolation:
            self._reject_snapshot(wire)
            raise
        if not await self._send_snapshot(frames):
            self._reject_snapshot(wire)
            return None
        self._accept_snapshot(wire, sent_snapshot)
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
        try:
            frames, sent_snapshot = self._encode_snapshot(wire)
        except ProtocolViolation:
            self._reject_snapshot(wire)
            return None

        writer = self._writer
        if writer is None:
            self._reject_snapshot(wire)
            return None
        try:
            for frame in frames:
                writer.write(frame)
        except (OSError, ConnectionResetError):
            self._reject_snapshot(wire)
            asyncio.ensure_future(self.close())
            return None

        self._accept_snapshot(wire, sent_snapshot)
        asyncio.ensure_future(self._drain(writer))
        return self.marker(wire["revision"])

    def _encode_snapshot(
        self, wire: Dict[str, Any]
    ) -> Tuple[Tuple[bytes, ...], bool]:
        """Build and encode a whole publication before writing any of it.

        ``maxFrameBytes`` may be tighter than ``maxSnapshotBytes``. Encoding
        every message first keeps that local refusal atomic: no tree, commit or
        marker escapes.
        """
        messages = []
        sent_snapshot = self.subscribe != "revisions"
        if self.subscribe != "revisions":
            self._log("io", f"r{wire['revision']} snapshot nodes={len(wire.get('nodes', ()))}")
            messages.append(snapshot_message(wire))
        messages.append(revision_commit(wire["revision"]))
        return (
            tuple(encode_frame(message, self._limits.maxFrameBytes) for message in messages),
            sent_snapshot,
        )

    async def _send_snapshot(self, frames: Sequence[bytes]) -> bool:
        writer = self._writer
        if writer is None:
            return False
        try:
            for frame in frames:
                writer.write(frame)
        except (OSError, ConnectionResetError):
            await self.close()
            return False
        return await self._drain(writer)

    def _accept_snapshot(self, wire: Dict[str, Any], sent_snapshot: bool) -> None:
        """Commit bookkeeping only after every frame was accepted for writing."""

        if sent_snapshot:
            self.snapshots_sent += 1

    def _reject_snapshot(self, wire: Dict[str, Any]) -> None:
        """Undo a locally refused revision."""

        revision = wire["revision"]
        if self.revision == revision:
            self.revision -= 1

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

    def fail_nowait(self, code: str, message: str) -> None:
        """Send one typed fatal producer error, then close the semantic channel."""
        writer = self._writer
        if writer is None or not self.connected:
            return
        try:
            writer.write(encode_frame(protocol_error(code, message[:1024]), self._limits.maxFrameBytes))
        except (OSError, ConnectionResetError, ValueError):
            asyncio.ensure_future(self.close())
            return

        async def finish() -> None:
            await self._drain(writer)
            await self.close()

        asyncio.ensure_future(finish())

    def _log(self, category: str, message: str) -> None:
        """Write one diagnostic line, when diagnostics are on."""
        if self._debug is not None:
            self._debug.line(category, message)

    async def _send(self, message: Mapping[str, Any]) -> None:
        writer = self._writer
        if writer is None:
            return
        frame = encode_frame(message, self._limits.maxFrameBytes)
        try:
            writer.write(frame)
        except (OSError, ConnectionResetError):
            await self.close()
            return
        await self._drain(writer)

    async def _drain(self, writer: Any) -> bool:
        """Drain already-written frames and make background failures quiet."""

        try:
            if self._write_timeout > 0:
                await asyncio.wait_for(writer.drain(), self._write_timeout)
            else:
                await writer.drain()
        except asyncio.TimeoutError:
            # Part of a length-prefixed frame may already be on the wire and
            # there is no resynchronisation point, so the session is over
            # rather than merely delayed.
            self._log(
                "diag",
                f"write deadline of {int(self._write_timeout * 1000)}ms exceeded; "
                "session is unrecoverable",
            )
            await self.close()
            return False
        except (OSError, ConnectionResetError):
            await self.close()
            return False
        return True

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
            self._log("diag", f"rejected a driver message: {parsed.detail[:200]}")
            await self._send(protocol_error("malformed", parsed.detail[:512]))
            await self.close()
            return
        message = parsed.message
        assert message is not None

        if message["type"] == "hello-ack":
            if message["protocol"] != PROTOCOL_ID:
                self._log("diag", f"driver acknowledged {message['protocol']} after requesting {PROTOCOL_ID}")
                await self.close()
                return
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
            if self._debug is not None:
                self._debug.label = self.session_id or ""
                self._log(
                    "sem",
                    f"hello-ack session={self.session_id} marker={'on' if self.marker_enabled else 'off'} "
                    f"subscribe={self.subscribe} logs={'on' if self._log_bucket is not None else 'off'}",
                )
            if self._ready is not None and not self._ready.done():
                self._ready.set_result(True)
        elif message["type"] == "error":
            self._log("diag", f"driver ended the session: {message.get('code')}")
            await self.close()


def client_from_env(
    *,
    adapter_name: str,
    adapter_version: str,
    capabilities: Sequence[str] = DEFAULT_CAPABILITIES,
    env: Optional[Mapping[str, str]] = None,
    limits: ProtocolLimits = DEFAULT_LIMITS,
    debug: Optional[DebugLog] = None,
    probe: Optional[Mapping[str, Any]] = None,
    evidence_registry: Optional[EvidenceProviderRegistry] = None,
) -> Optional[SemanticClient]:
    """Build a client from ``TERMWRIGHT_*``, or ``None`` when not instrumented.

    This is the dormant rule in one function: no endpoint or no token means no
    client, and the caller must then do nothing at all.

    When diagnostics are enabled — by ``TERMWRIGHT_DEBUG_FILE``, or by passing
    ``debug`` — the *reason* for staying dormant is written to the log before
    returning ``None``. That line is the whole point of the file: a run where
    the adapter never attached otherwise leaves no trace anywhere.
    """
    source: Mapping[str, str] = os.environ if env is None else env
    log = DebugLog.from_env(source, adapter=adapter_name) if debug is None else debug
    endpoint = source.get(ENV_ENDPOINT)
    token = source.get(ENV_TOKEN)
    if not endpoint or not token:
        if log is not None:
            missing = [
                name
                for name, value in ((ENV_ENDPOINT, endpoint), (ENV_TOKEN, token))
                if not value
            ]
            log.line("diag", f"dormant: {' and '.join(missing)} not set")
        return None
    return SemanticClient(
        endpoint,
        token,
        adapter_name=adapter_name,
        adapter_version=adapter_version,
        capabilities=capabilities,
        limits=limits,
        debug=log,
        probe=probe,
        evidence_registry=evidence_registry or default_evidence_provider_registry(),
    )


def _error_label(error: BaseException) -> str:
    """One-line description of a failure: class, errno and first message line.

    The class alone is what usually settles a Windows question — a
    ``FileNotFoundError`` on a pipe path means the driver was never listening,
    while a ``NotImplementedError`` means the loop could not open one at all —
    so it is always printed, even when the message is empty.
    """
    code = getattr(error, "errno", None)
    suffix = f" [errno {code}]" if code is not None else ""
    text = str(error).split("\n")[0]
    return f"{type(error).__name__}{suffix}" + (f": {text}" if text else "")
