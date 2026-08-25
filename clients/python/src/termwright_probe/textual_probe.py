"""Exact Textual 8.2.8 frame observation.

``post_display_hook`` alone is not a commit boundary: Textual invokes it from
``App._display``'s ``finally`` block even when no render was attempted or the
render failed. The probe combines that hook with evidence that the exact
driver enqueued the display attempt, then appends the marker non-blockingly to
the same certified WriterThread FIFO.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable, List, Mapping, Optional, Union
from weakref import WeakKeyDictionary

from .certified_textual import CERTIFIED_TEXTUAL_VERSIONS

REQUIRED_APP_ATTRIBUTES = (
    "post_display_hook", "_display", "refresh", "screen", "focused",
    "size",
)


@dataclass(frozen=True)
class CommittedTextualFrame:
    """The exact app, screen and writer which committed one Textual frame."""

    app: Any
    screen: Any
    driver: Any
    preflight_marker: Callable[[], None]
    enqueue_marker: Callable[[str], Any]


@dataclass(frozen=True)
class TextualCommitFailure:
    """A display completed, but its terminal commit cannot be certified."""

    app: Any
    detail: str


TextualFrameEvent = Union[CommittedTextualFrame, TextualCommitFailure]
FrameObserver = Callable[[TextualFrameEvent], None]


@dataclass(frozen=True)
class _MarkerWriter:
    preflight: Callable[[], None]
    enqueue: Callable[[str], Any]


@dataclass
class _DriverEvidence:
    write_revision: int = 0
    writer_thread: Any = None


@dataclass
class _DisplayAttempt:
    screen: Any
    driver: Any
    entry_exception: Optional[BaseException]
    entry_app_exception: Optional[BaseException]
    entry_write_revision: int
    eligible: bool
    hook_notified: bool = False


_observers: List[FrameObserver] = []
_attached_modules: List[int] = []
_frames = 0
_display_attempts: "WeakKeyDictionary[Any, List[_DisplayAttempt]]" = WeakKeyDictionary()
_driver_evidence: "WeakKeyDictionary[Any, _DriverEvidence]" = WeakKeyDictionary()
_MISSING = object()
_patches: List[tuple[Any, str, Any]] = []
_patch_keys: set[tuple[Any, str]] = set()


def _install_patch(owner: Any, name: str, replacement: Any) -> bool:
    """Install one reversible class mutation, retaining descriptor identity."""
    key = (owner, name)
    if key in _patch_keys:
        return True
    original = owner.__dict__.get(name, _MISSING)
    try:
        setattr(owner, name, replacement)
    except (AttributeError, TypeError):
        return False
    _patches.append((owner, name, original))
    _patch_keys.add(key)
    return True


def _current_exception() -> Optional[BaseException]:
    return sys.exc_info()[1]


def _evidence_for(driver: Any) -> Optional[_DriverEvidence]:
    try:
        evidence = _driver_evidence.get(driver)
        if evidence is None:
            evidence = _DriverEvidence()
            _driver_evidence[driver] = evidence
        return evidence
    except TypeError:
        return None


def _wrap_driver_method(driver_type: Any, name: str) -> bool:
    """Observe successful calls at the narrow, exact 8.2.8 driver seam."""
    owner = next((cls for cls in driver_type.__mro__ if name in cls.__dict__), None)
    if owner is None:
        return False
    original = owner.__dict__[name]
    if not callable(original):
        return False
    marker = f"__termwright_textual_{name}_observed__"
    if getattr(original, marker, False):
        return True

    @wraps(original)
    def observed(self: Any, *args: Any, **kwargs: Any) -> Any:
        result = original(self, *args, **kwargs)
        evidence = _evidence_for(self)
        if evidence is not None:
            evidence.write_revision += 1
            evidence.writer_thread = getattr(self, "_writer_thread", None)
        return result

    setattr(observed, marker, True)
    return _install_patch(owner, name, observed)


def _prepare_driver(driver: Any) -> Optional[_DriverEvidence]:
    if driver is None or not _is_certified_builtin_driver(driver):
        return None
    if not _wrap_driver_method(type(driver), "write"):
        return None
    return _evidence_for(driver)


def _is_certified_builtin_driver(driver: Any) -> bool:
    """Accept only the exact platform driver classes certified for 8.2.8."""
    try:
        if sys.platform == "win32":
            from textual.drivers.windows_driver import WindowsDriver

            return type(driver) is WindowsDriver
        from textual.drivers.linux_driver import LinuxDriver

        return type(driver) is LinuxDriver
    except (ImportError, AttributeError):
        return False


def _is_certified_writer_thread(writer_thread: Any) -> bool:
    """Check the exact 8.2.8 WriterThread and its bounded FIFO identity."""
    try:
        from queue import Queue
        from textual.drivers._writer_thread import WriterThread
    except ImportError:
        return False
    queue = getattr(writer_thread, "_queue", None)
    return bool(
        type(writer_thread) is WriterThread
        and type(queue) is Queue
        and getattr(queue, "maxsize", None) == 30
    )


def _marker_writer_for(driver: Any) -> Optional[_MarkerWriter]:
    """Return the exact 8.2.8 non-blocking same-writer enqueue operation.

    Textual's public ``Driver.write`` may block the event loop on
    ``WriterThread``'s bounded queue and ``Driver.flush`` is a no-op. The
    certified Linux and Windows drivers expose their WriterThread instance;
    its FIFO queue has the only operation that is both causal and non-blocking.
    """
    if not _is_certified_builtin_driver(driver):
        return None
    writer_thread = getattr(driver, "_writer_thread", None)
    if not _is_certified_writer_thread(writer_thread):
        return None
    queue = getattr(writer_thread, "_queue", None)
    put_nowait = getattr(queue, "put_nowait", None)
    is_alive = getattr(writer_thread, "is_alive", None)
    if not callable(put_nowait) or not callable(is_alive) or not is_alive():
        return None

    def validate() -> None:
        if getattr(driver, "_writer_thread", None) is not writer_thread:
            raise RuntimeError("Textual replaced the committed WriterThread")
        if not writer_thread.is_alive():
            raise RuntimeError("Textual WriterThread stopped before marker enqueue")
        if getattr(writer_thread, "_queue", None) is not queue:
            raise RuntimeError("Textual replaced the committed WriterThread queue")

    def preflight() -> None:
        validate()
        if queue.full():
            raise RuntimeError("Textual WriterThread queue is full before snapshot publication")

    def enqueue(marker: str) -> Any:
        validate()
        return put_nowait(marker)

    return _MarkerWriter(preflight, enqueue)


def _wrap_display(owner: Any) -> None:
    original = owner.__dict__.get("_display")
    if original is None or getattr(original, "__termwright_display_observed__", False):
        return

    @wraps(original)
    def observed(self: Any, screen: Any, renderable: Any) -> Any:
        driver = getattr(self, "_driver", None)
        evidence = _prepare_driver(driver)
        entry_app_exception = getattr(self, "_exception", None)
        eligible = bool(
            renderable is not None
            and driver is not None
            and bool(getattr(self, "_running", False))
            and not bool(getattr(self, "_closed", False))
            and not bool(getattr(self, "_batch_count", 0))
            and not bool(getattr(self, "is_headless", False))
            and not bool(getattr(driver, "is_headless", False))
            and entry_app_exception is None
        )
        attempt = _DisplayAttempt(
            screen, driver, _current_exception(), entry_app_exception,
            evidence.write_revision if evidence is not None else 0, eligible,
        )
        try:
            attempts = _display_attempts.setdefault(self, [])
        except TypeError:
            return original(self, screen, renderable)
        attempts.append(attempt)
        try:
            return original(self, screen, renderable)
        finally:
            attempts.pop()
            if not attempts:
                _display_attempts.pop(self, None)

    observed.__termwright_display_observed__ = True  # type: ignore[attr-defined]
    _install_patch(owner, "_display", observed)


def _failure(app: Any, detail: str) -> TextualCommitFailure:
    return TextualCommitFailure(app, detail)


def _committed_event(app: Any, attempt: _DisplayAttempt) -> Optional[TextualFrameEvent]:
    if attempt.hook_notified or not attempt.eligible:
        return None
    attempt.hook_notified = True
    driver = attempt.driver
    try:
        same_screen = app.screen is attempt.screen
    except Exception as error:
        return _failure(
            app,
            f"Textual could not verify the committed screen identity: {type(error).__name__}: {error}",
        )
    if not same_screen:
        return _failure(app, "Textual replaced the screen after the committed display write")
    if getattr(app, "_driver", None) is not driver:
        return _failure(app, "Textual replaced the driver after the committed display write")
    if (
        getattr(app, "_exception", None) is not attempt.entry_app_exception
        or _current_exception() is not attempt.entry_exception
    ):
        return None
    if not _is_certified_builtin_driver(driver):
        return _failure(
            app,
            f"Textual driver {type(driver).__module__}.{type(driver).__qualname__} is not an exact certified built-in driver",
        )
    evidence = _evidence_for(driver)
    if evidence is None or evidence.write_revision <= attempt.entry_write_revision:
        return _failure(app, "Textual display completed without exact built-in driver write evidence")
    if bool(getattr(driver, "is_inline", False)):
        return _failure(app, "Textual inline driver commits are not certified for same-writer markers")
    if getattr(driver, "_writer_thread", None) is not evidence.writer_thread:
        return _failure(app, "Textual replaced the WriterThread after the committed display write")
    marker_writer = _marker_writer_for(driver)
    if marker_writer is None:
        return _failure(app, "Textual committed display has no live exact certified WriterThread")
    return CommittedTextualFrame(
        app, attempt.screen, driver, marker_writer.preflight, marker_writer.enqueue
    )


def _wrap_hook(owner: Any) -> None:
    original = owner.__dict__.get("post_display_hook")
    if original is None or getattr(original, "__termwright_hook_observed__", False):
        return

    @wraps(original)
    def observed(self: Any) -> Any:
        attempts = _display_attempts.get(self)
        if attempts:
            event = _committed_event(self, attempts[-1])
            if event is not None:
                _notify(event)
        return original(self)

    observed.__termwright_hook_observed__ = True  # type: ignore[attr-defined]
    _install_patch(owner, "post_display_hook", observed)


def on_frame(observer: FrameObserver) -> None:
    _observers.append(observer)


def missing_assumptions(app_class: Any) -> List[str]:
    return [name for name in REQUIRED_APP_ATTRIBUTES if not hasattr(app_class, name)]


def _wrap_app_class(owner: Any) -> None:
    _wrap_display(owner)
    _wrap_hook(owner)


def attach_to_app_module(module: Any) -> bool:
    version = _textual_version()
    if not is_textual_version_certified(version):
        _log("diag", f"not attaching: Textual {version} has no exact certification")
        return False
    app_class = getattr(module, "App", None)
    if app_class is None:
        _log("diag", "textual.app has no App class; not attaching")
        return False
    if id(module) in _attached_modules:
        return False
    absent = missing_assumptions(app_class)
    if absent:
        _log("diag", "not attaching: this Textual is missing " + ", ".join(absent))
        return False

    _wrap_app_class(app_class)

    def descendants(owner: Any):
        for child in owner.__subclasses__():
            yield child
            yield from descendants(child)

    for child in descendants(app_class):
        _wrap_app_class(child)

    init_descriptor = app_class.__dict__.get("__init_subclass__")
    if isinstance(init_descriptor, classmethod):
        original_init_subclass = init_descriptor.__func__

        def init_subclass(cls: Any, *args: Any, **kwargs: Any) -> None:
            original_init_subclass(cls, *args, **kwargs)
            _wrap_app_class(cls)

        _install_patch(app_class, "__init_subclass__", classmethod(init_subclass))
    _attached_modules.append(id(module))
    _log("sem", f"attached to Textual {version}")
    _publish_frames()
    return True


_sessions: "WeakKeyDictionary[Any, Any]" = WeakKeyDictionary()


def _publish_frames() -> None:
    def publish(event: TextualFrameEvent) -> None:
        from . import _owns_current_process

        if not _owns_current_process():
            return
        session = _sessions.get(event.app)
        if session is None:
            from .session import session_for

            session = session_for(event.app, _textual_version())
            if session is None:
                _sessions[event.app] = _DORMANT
                return
            _sessions[event.app] = session
        if session is not _DORMANT:
            session.on_frame(event)

    on_frame(publish)


class _Dormant:
    pass


_DORMANT = _Dormant()


def frames_seen() -> int:
    return _frames


def _notify(event: TextualFrameEvent) -> None:
    global _frames
    _frames += 1
    if _frames == 1:
        _log("sem", "first frame observed")
    for observer in list(_observers):
        try:
            observer(event)
        except Exception as error:
            _log("diag", f"frame observer failed: {type(error).__name__}: {error}")


def _textual_version() -> str:
    try:
        from importlib.metadata import version

        return version("textual")
    except Exception:
        return "unknown"


def is_textual_version_certified(version: str, env: Optional[Mapping[str, str]] = None) -> bool:
    if version in CERTIFIED_TEXTUAL_VERSIONS:
        return True
    source = os.environ if env is None else env
    return bool(
        source.get("GITHUB_ACTIONS") == "true"
        and source.get("TERMWRIGHT_CERTIFICATION_TEXTUAL_VERSION") == version
        and re.fullmatch(r"sha256:[0-9a-f]{64}", source.get("TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST", ""))
        and re.fullmatch(r"[0-9a-f]{40}", source.get("GITHUB_SHA", ""))
        and source.get("TERMWRIGHT_CERTIFICATION_SOURCE_REVISION") == source.get("GITHUB_SHA")
    )


_debug: Optional[Any] = None


def _log(category: str, message: str) -> None:
    global _debug
    if _debug is None:
        try:
            from termwright.debug import DebugLog

            _debug = DebugLog.from_env(adapter="textual-probe") or False
        except Exception:
            _debug = False
    line = getattr(_debug, "line", None)
    if line is not None:
        line(category, message)


def reset() -> None:
    global _frames
    _sessions.clear()
    _observers.clear()
    _attached_modules.clear()
    _display_attempts.clear()
    _driver_evidence.clear()
    for owner, name, original in reversed(_patches):
        if original is _MISSING:
            delattr(owner, name)
        else:
            setattr(owner, name, original)
    _patches.clear()
    _patch_keys.clear()
    _frames = 0
