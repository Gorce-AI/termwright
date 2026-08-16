"""Bridge from the standard library's :mod:`logging` to the semantic channel.

A TUI must not write diagnostics to the screen, so the usual advice is to send
them to a file. Under the driver they can go somewhere better: attach this
handler and every record the application already emits becomes assertable test
state, with the application's own logging calls unchanged.

    from termwright import client_from_env
    from termwright.logging_bridge import install_log_handler

    client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0",
                             capabilities=CAPABILITIES_WITH_LOGS)
    if client is not None and await client.start():
        install_log_handler(client)

Dormant by construction: with no client there is no handler, so an app that
ships this call unconditionally still logs exactly as it did before.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from .client import SemanticClient
from .logs import flatten_attrs

#: Python's ladder onto the wire's. `logging` has no `trace` or `fatal` of its
#: own: anything below DEBUG is trace, and CRITICAL is fatal.
_LEVEL_BY_NUMBER = (
    (logging.CRITICAL, "fatal"),
    (logging.ERROR, "error"),
    (logging.WARNING, "warn"),
    (logging.INFO, "info"),
    (logging.DEBUG, "debug"),
)

#: Attributes every :class:`logging.LogRecord` carries; anything else on the
#: record was put there by the application and is worth forwarding.
_STANDARD_FIELDS = frozenset(
    {
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "message", "module",
        "msecs", "msg", "name", "pathname", "process", "processName",
        "relativeCreated", "stack_info", "taskName", "thread", "threadName",
    }
)


def level_for(levelno: int) -> str:
    """Map a :mod:`logging` level number onto a wire level."""
    for threshold, name in _LEVEL_BY_NUMBER:
        if levelno >= threshold:
            return name
    return "trace"


class TermwrightLogHandler(logging.Handler):
    """A :class:`logging.Handler` that forwards records to the driver.

    Never raises into the application: a handler that threw would turn a log
    line into a crash, so failures are counted on the client and dropped.
    """

    def __init__(self, client: SemanticClient, level: int = logging.NOTSET) -> None:
        super().__init__(level)
        self._client = client

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self._client.log(
                level_for(record.levelno),
                self.format(record) if self.formatter else record.getMessage(),
                attrs=self._attrs(record),
                logger=record.name,
                ts=int(record.created * 1000),
            )
        except Exception:  # pragma: no cover - logging must never break the app
            self.handleError(record)

    def _attrs(self, record: logging.LogRecord) -> Optional[Dict[str, Any]]:
        """Application-supplied `extra` fields, flattened to dotted keys."""
        extra = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _STANDARD_FIELDS and not key.startswith("_")
        }
        if record.exc_info and record.exc_info[0] is not None:
            extra["exception"] = record.exc_info[0].__name__
        return flatten_attrs(extra) if extra else None


def install_log_handler(
    client: Optional[SemanticClient],
    logger: Optional[logging.Logger] = None,
    level: int = logging.NOTSET,
) -> Optional[TermwrightLogHandler]:
    """Attach a handler to ``logger`` (the root logger by default).

    :param client: A live client, or ``None`` — in which case nothing is
        installed and ``None`` comes back, so the dormant path stays a no-op.
    :returns: The installed handler, for later :meth:`logging.Logger.removeHandler`.
    """
    if client is None:
        return None
    handler = TermwrightLogHandler(client, level)
    (logger or logging.getLogger()).addHandler(handler)
    return handler
