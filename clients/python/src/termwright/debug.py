"""Opt-in diagnostic log for the adapter side, written to a file.

The driver has its own live log (`TERMWRIGHT_DEBUG=1`, stderr, see
`packages/driver/src/debug.ts`). This is the other half: what the *adapter*
inside the application decided, which is the half that goes missing when a
conformance run reports skips and nobody can say why the app never attached.

**Never stderr.** The application under test owns the terminal; a stray line on
stderr lands in the middle of a render and corrupts the very screen the driver
is asserting on. So this log goes to a file the caller names, or nowhere.

**Never fatal.** Every failure here — an unwritable path, a full disk, a closed
file — leaves the application running and the log silently off. A diagnostic
that can break the thing it diagnoses is worse than no diagnostic.

Enable it with either variable::

    TERMWRIGHT_DEBUG_FILE=/tmp/adapter.log     # preferred
    TERMWRIGHT_DEBUG=/tmp/adapter.log          # path, not 1/true/all

The second form is a convenience, and it is deliberately restricted to values
that are *not* the driver's own switches: `TERMWRIGHT_DEBUG=1` reaches the
child process too, and if that turned this log on it would have to invent a
destination for it. So `1`, `true`, `on`, `api`, `all`, `0`, `false` and `off`
all leave the adapter silent, and only a path enables it.

The line format matches the driver's so one reader can take both::

      tw:diag [p41207]   0.004s dormant: TERMWRIGHT_ENDPOINT is not set
"""

from __future__ import annotations

import os
import sys
import threading
import time
from typing import Mapping, Optional

#: Names the file this log is written to. Preferred over `TERMWRIGHT_DEBUG`
#: because it cannot collide with the driver's stderr switch.
ENV_DEBUG_FILE = "TERMWRIGHT_DEBUG_FILE"

#: The driver's switch, honoured here only when it carries a path.
ENV_DEBUG = "TERMWRIGHT_DEBUG"

#: Values of `TERMWRIGHT_DEBUG` that mean "driver-side logging" and must not be
#: mistaken for a filename.
_DRIVER_SWITCHES = frozenset({"", "0", "1", "true", "false", "on", "off", "api", "all"})

#: Categories, borrowed from the driver so a reader greps one vocabulary.
#: `diag` is a decision or a failure, `sem` the semantic session, `io` traffic.
_CATEGORIES = ("diag", "sem", "io", "app")

_MAX_MESSAGE = 400


def debug_path(env: Optional[Mapping[str, str]] = None) -> Optional[str]:
    """The file this process should log to, or ``None`` to stay silent."""
    source: Mapping[str, str] = os.environ if env is None else env
    explicit = (source.get(ENV_DEBUG_FILE) or "").strip()
    if explicit:
        return explicit
    raw = (source.get(ENV_DEBUG) or "").strip()
    if not raw or raw.lower() in _DRIVER_SWITCHES:
        return None
    return raw


class DebugLog:
    """Appends diagnostic lines to one file.

    Instances are cheap but not free — they hold an open file — so build one
    per process and pass it down, which is what :func:`from_env` encourages.
    """

    def __init__(self, handle, *, label: str, now=time.monotonic) -> None:
        self._handle = handle
        self._label = label
        self._now = now
        self._started = now()
        self._lock = threading.Lock()

    # -- construction ------------------------------------------------------

    @classmethod
    def from_env(
        cls,
        env: Optional[Mapping[str, str]] = None,
        *,
        adapter: str = "adapter",
    ) -> Optional["DebugLog"]:
        """Open the log named by the environment, or return ``None``.

        Returns ``None`` for every failure, including an unwritable path: a
        diagnostic that refuses to start must not stop the application.
        """
        path = debug_path(env)
        if path is None:
            return None
        try:
            handle = open(path, "a", encoding="utf-8", errors="replace")
        except OSError:
            return None
        log = cls(handle, label=f"p{os.getpid()}")
        log.line(
            "diag",
            f"open adapter={adapter} pid={os.getpid()} platform={sys.platform} "
            f"python={sys.version_info[0]}.{sys.version_info[1]} argv0={_short(sys.argv[0] if sys.argv else '')}",
        )
        return log

    # -- writing -----------------------------------------------------------

    @property
    def label(self) -> str:
        """The bracketed identifier on every line."""
        return self._label

    @label.setter
    def label(self, value: str) -> None:
        """Adopt the driver's session id once the handshake supplies one."""
        self._label = value[:8] if value else self._label

    def line(self, category: str, message: str) -> None:
        """Write one line. Silently does nothing once the file is gone."""
        if category not in _CATEGORIES:
            category = "diag"
        if len(message) > _MAX_MESSAGE:
            message = f"{message[:_MAX_MESSAGE]}…"
        seconds = f"{self._now() - self._started:.3f}".rjust(7)
        text = f"  tw:{category.ljust(4)} [{self._label}] {seconds}s {message}\n"
        with self._lock:
            handle = self._handle
            if handle is None:
                return
            try:
                handle.write(text)
                handle.flush()
            except (OSError, ValueError):
                # ValueError covers a file closed underneath us. Either way the
                # log is over; the application is not.
                self._handle = None

    def close(self) -> None:
        """Close the file. Safe to call more than once."""
        with self._lock:
            handle, self._handle = self._handle, None
        if handle is not None:
            try:
                handle.close()
            except OSError:
                pass


def _short(value: str, limit: int = 60) -> str:
    """A path or argument shortened for one log line."""
    return value if len(value) <= limit else f"…{value[-(limit - 1):]}"


def describe_endpoint(endpoint: str) -> str:
    """How an endpoint reads in the log: its transport and its path.

    The endpoint is not a secret — the token is, and the token never appears
    here — but it is long, so it is shortened from the left, keeping the tail
    that distinguishes one session's socket from another's.
    """
    kind = "pipe" if endpoint.startswith("\\\\") else "unix"
    return f"{kind}:{_short(endpoint)}"
