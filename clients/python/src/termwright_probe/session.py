"""One instrumented Textual application: connect, publish, commit.

The session lives between the frame hook and the protocol client. Each
completed frame becomes a snapshot, the snapshot's revision becomes a marker,
and the marker is written after the frame's last byte — which is what lets the
driver match a tree to the pixels that were on screen when it was true.

Everything here is written to fail quietly. The application under test owns
the terminal and the exit code; a side channel that cannot connect, cannot
build a tree, or cannot write must leave the app running exactly as it would
have run on its own.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Dict, Optional

from termwright.client import DEFAULT_CAPABILITIES, SemanticClient, client_from_env

from . import __version__
from .textual_tree import Identities, build_snapshot

#: What this probe tells the driver it can do.
#:
#: `frame-begin` is deliberately absent: `post_display_hook` runs after the
#: flush, so there is no moment we could honestly report as the start of a
#: frame. `paint-order` and `visible-rect` are claimed because Textual
#: computes both and we read them rather than deriving them.
PROBE_CAPABILITIES = ("stable-identity", "visible-rect", "annotations", "paint-order")


def probe_info(framework_version: Optional[str] = None) -> Dict[str, Any]:
    """The `ProbeInfo` this probe sends with `hello`."""
    info: Dict[str, Any] = {
        "framework": "textual",
        "probeVersion": __version__,
        # Textual keeps a retained DOM, so a widget object outlives the frame
        # and its identity can be correlated across frames.
        "identityKind": "stable",
        "capabilities": list(PROBE_CAPABILITIES),
    }
    if framework_version:
        info["frameworkVersion"] = framework_version
    return info


class ProbeSession:
    """Publishes one Textual application's tree for the life of the process."""

    def __init__(self, app: Any, client: SemanticClient) -> None:
        self._app = app
        self._client = client
        self._identities = Identities()
        self._starting = False
        self._started = False
        # Coalesced snapshot of the latest *completed* frame seen while the
        # handshake is in flight. It is not an event queue: one immutable
        # terminal state is retained so a stationary application still gets a
        # semantic tree after connecting, without waiting for an unrelated
        # future repaint.
        self._pending_snapshot = None
        #: Frames that arrived before the handshake finished, or while a
        #: previous publish was still in flight. Counted, never queued: at most
        #: one coalesced observation of the latest completed frame is retained.
        self.frames_dropped = 0

    @property
    def client(self) -> SemanticClient:
        return self._client

    def on_frame(self) -> None:
        """Called once per completed frame. Never raises into Textual."""
        try:
            self._on_frame()
        except Exception as error:  # pragma: no cover - defensive
            _log("diag", f"frame handling failed: {type(error).__name__}: {error}")

    def _on_frame(self) -> None:
        if not self._started:
            self._begin()
            self._capture_pending()
            self._drop()
            return
        if not self._client.connected:
            self._capture_pending()
            self._drop()
            return

        snapshot = self._snapshot()
        marker = self._client.publish_nowait(snapshot)
        if marker:
            self._write(marker)

    def _snapshot(self):
        return build_snapshot(
            self._app,
            self._identities,
            session_id=self._client.session_id or "pending",
            revision=self._client.revision + 1,
            qualified=self._client.protocol == "termwright/2",
        )

    def _capture_pending(self) -> None:
        """Retain only the newest completed frame while connecting."""
        self._pending_snapshot = self._snapshot()

    def _publish_pending(self) -> None:
        snapshot, self._pending_snapshot = self._pending_snapshot, None
        if snapshot is None or not self._client.connected:
            return
        marker = self._client.publish_nowait(snapshot)
        if marker:
            self._write(marker)

    def _drop(self) -> None:
        """Record a frame that never reached the driver.

        The count is diagnostics; the obligation is protocol. A tree the driver
        never saw means the next one it does see must be whole — a patch would
        be applied to a state that never accounted for what was skipped, and
        nothing would report the divergence.
        """
        self.frames_dropped += 1
        self._client.require_full_snapshot()

    def _begin(self) -> None:
        """Start the handshake, once, from inside the running event loop."""
        if self._starting:
            return
        self._starting = True

        async def connect() -> None:
            ok = await self._client.start()
            self._started = ok
            if ok:
                self._publish_pending()
            else:
                _log("diag", "probe session did not start; publishing nothing")

        try:
            asyncio.ensure_future(connect())
        except RuntimeError:
            # No running loop: nothing to attach to, and nothing to report to
            # either. The application keeps its terminal.
            self._starting = False

    def _write(self, text: str) -> None:
        """Emit the marker on the same stream the frame went out on.

        Textual's driver is preferred: writing through it keeps our bytes in
        the same ordering as the frame's, which is the whole point of a marker
        that commits the bytes before it.
        """
        driver = getattr(self._app, "_driver", None)
        if driver is not None and hasattr(driver, "write"):
            try:
                driver.write(text)
                driver.flush()
                return
            except Exception:
                pass
        stream = sys.__stdout__ or sys.stdout
        try:
            stream.write(text)
            stream.flush()
        except Exception:
            pass


def session_for(app: Any, framework_version: Optional[str] = None) -> Optional[ProbeSession]:
    """Build a session for `app`, or `None` when the process is not instrumented.

    The dormant rule reaches all the way here: `client_from_env` returns `None`
    without an endpoint and a token, and then no session exists to publish
    anything.
    """
    client = client_from_env(
        adapter_name="textual-probe",
        adapter_version=__version__,
        # The zero-config probe publishes semantic frames only. Application
        # logs remain an explicit client feature: no handler is installed here,
        # so advertising `logs` would promise traffic this path cannot emit.
        capabilities=DEFAULT_CAPABILITIES,
        qualified_capabilities=("pointer-hit-grid",),
        probe=probe_info(framework_version),
    )
    if client is None:
        return None
    return ProbeSession(app, client)


def _log(category: str, message: str) -> None:
    from .textual_probe import _log as write

    write(category, message)
