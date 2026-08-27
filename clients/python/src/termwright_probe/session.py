"""One instrumented Textual application: connect, publish, commit.

The session lives between the frame hook and the protocol client. Each
completed frame becomes a snapshot and its marker is appended to the observed
WriterThread FIFO after the frame. That causal order lets the driver match the
tree to the terminal bytes without blocking Textual's event loop.

Everything here is written to fail quietly. The application under test owns
the terminal and the exit code; a side channel that cannot connect, cannot
build a tree, or cannot write must leave the app running exactly as it would
have run on its own.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, Optional

from termwright.client import SemanticClient, client_from_env

from . import __version__
from .textual_probe import CommittedTextualFrame, TextualCommitFailure, TextualFrameEvent
from .textual_tree import (
    DuplicateSemanticKeyError,
    Identities,
    TextualObservationError,
    build_snapshot,
)

#: What this probe tells the driver it can do.
#:
#: `frame-begin` is deliberately absent: `post_display_hook` runs after the
#: frame enqueue, so there is no moment we could honestly report as the start
#: of a frame. `paint-order` and `visible-rect` are claimed because Textual
#: computes both and we read them rather than deriving them.
PROBE_CAPABILITIES = (
    "stable-identity",
    "intended-rect",
    "visible-rect",
    "annotations",
    "paint-order",
)
TEXTUAL_CAPABILITIES = (
    "tree",
    "intended-geometry",
    "clipped-geometry",
    "states",
    "focus-state",
    "actions",
    "render-revisions",
    "pointer-hit-grid",
)


def probe_info(framework_version: Optional[str] = None) -> Dict[str, Any]:
    """The `ProbeInfo` this probe sends with `hello`."""
    info: Dict[str, Any] = {
        "framework": "textual",
        "probeVersion": __version__,
        # Textual keeps a retained DOM, so a widget object outlives the frame
        # and its identity can be correlated across frames.
        "identityKind": "stable",
        "capabilities": list(PROBE_CAPABILITIES),
        "instrumentation": {
            "highestTier": "T3",
            "semanticClass": "A",
            "degradedCapabilities": ["inactive-screen-tree"],
        },
    }
    if framework_version:
        info["frameworkVersion"] = framework_version
    return info


class ProbeSession:
    """Publishes one Textual application's tree for the life of the process."""

    def __init__(self, app: Any, client: SemanticClient) -> None:
        self._app = app
        self._client = client
        self._owner_pid = os.getpid()
        self._identities = Identities()
        self._starting = False
        self._started = False
        self._fatal_error: Optional[tuple[str, str]] = None
        #: Frames before the handshake or after disconnect are counted and
        #: discarded. A snapshot is never retained across the handshake: its
        #: terminal bytes may no longer be current when the socket is ready.
        self.frames_dropped = 0

    @property
    def client(self) -> SemanticClient:
        return self._client

    def on_frame(self, event: TextualFrameEvent) -> None:
        """Called once per completed frame. Never raises into Textual."""
        if os.getpid() != self._owner_pid:
            return
        try:
            if isinstance(event, TextualCommitFailure):
                self._fatal("adapter-guarantee-violation", event.detail)
                if not self._started:
                    self._begin()
                return
            self._on_frame(event)
        except DuplicateSemanticKeyError as error:
            self._fatal("duplicate-semantic-key", str(error))
        except TextualObservationError as error:
            self._fatal("adapter-guarantee-violation", str(error))
        except Exception as error:  # pragma: no cover - defensive
            self._fatal(
                "internal", f"unexpected Textual frame failure: {type(error).__name__}: {error}"
            )

    def _on_frame(self, commit: CommittedTextualFrame) -> None:
        if self._fatal_error is not None:
            self._drop()
            return
        if not self._started:
            self._begin()
            self._drop()
            return
        if not self._client.connected:
            self._drop()
            return

        try:
            commit.preflight_marker()
        except Exception as error:
            self._fatal(
                "adapter-guarantee-violation",
                f"Textual commit marker preflight failed: {type(error).__name__}: {error}",
            )
            return

        snapshot = self._snapshot(commit)
        marker = self._client.publish_nowait(snapshot)
        if marker:
            self._write(commit, marker)

    def _snapshot(self, commit: CommittedTextualFrame):
        return build_snapshot(
            self._app,
            commit.screen,
            self._identities,
            session_id=self._client.session_id or "pending",
            revision=self._client.revision + 1,
        )

    def _drop(self) -> None:
        """Record a frame that never reached the driver."""
        self.frames_dropped += 1

    def _begin(self) -> None:
        """Start the handshake, once, from inside the running event loop."""
        if self._starting:
            return
        self._starting = True

        async def connect() -> None:
            ok = await self._client.start()
            self._started = ok
            if ok:
                if self._fatal_error is not None:
                    self._client.fail_nowait(*self._fatal_error)
                else:
                    try:
                        # Public Textual API: request a new render after the
                        # handshake. Only that future committed frame may be
                        # paired with a semantic snapshot.
                        self._app.refresh()
                    except Exception as error:
                        self._fatal(
                            "adapter-guarantee-violation",
                            f"Textual refresh after handshake failed: {type(error).__name__}: {error}",
                        )
            else:
                _log("diag", "probe session did not start; publishing nothing")

        try:
            asyncio.ensure_future(connect())
        except RuntimeError:
            # No running loop: nothing to attach to, and nothing to report to
            # either. The application keeps its terminal.
            self._starting = False

    def _write(self, commit: CommittedTextualFrame, text: str) -> None:
        """Non-blockingly enqueue after the frame on its verified FIFO writer."""
        try:
            commit.enqueue_marker(text)
        except Exception as error:
            try:
                from queue import Full

                queue_full = isinstance(error, Full)
            except ImportError:  # pragma: no cover - Python always provides queue
                queue_full = False
            detail = (
                "Textual WriterThread queue became full after snapshot publication"
                if queue_full
                else f"Textual commit marker write failed: {type(error).__name__}: {error}"
            )
            self._fatal(
                "adapter-guarantee-violation",
                detail,
            )

    def _fatal(self, code: str, message: str) -> None:
        if self._fatal_error is not None:
            return
        self._fatal_error = (code, message)
        self._client.fail_nowait(code, message)
        _log("diag", f"fatal Textual probe violation: {message}")


def session_for(app: Any, framework_version: Optional[str] = None) -> Optional[ProbeSession]:
    """Build a session for `app`, or `None` when the process is not instrumented.

    The bootstrap removes credentials from the live environment before the
    application starts. Only its process-local captured mapping reaches
    `client_from_env`; a forked descendant has no mapping and no session.
    """
    from . import _session_environment

    environment = _session_environment()
    if environment is None:
        return None
    client = client_from_env(
        adapter_name="textual-probe",
        adapter_version=__version__,
        # The zero-config probe publishes semantic frames only. Application
        # logs remain an explicit client feature: no handler is installed here,
        # so advertising `logs` would promise traffic this path cannot emit.
        capabilities=TEXTUAL_CAPABILITIES,
        probe=probe_info(framework_version),
        env=environment,
    )
    if client is None:
        return None
    return ProbeSession(app, client)


def _log(category: str, message: str) -> None:
    from .textual_probe import _log as write

    write(category, message)
