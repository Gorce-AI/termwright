"""Attaching to Textual, and the assumptions that have to hold first.

The attachment point is `App.post_display_hook`, chosen in the Phase 0 audit
(`docs/architecture/audit/textual.md` §5): Textual calls it from the `finally`
of `App._display`, after the compositor's output has been written and flushed,
which is the one moment when the DOM, the layout and the screen agree.

Two consequences of *when* it runs shape everything downstream:

- **The flush precedes the hook.** By the time we are called the frame is
  already on the terminal, so there is no frame-begin signal to report and the
  probe does not claim the `frame-begin` capability. This is the opposite of
  tview's `afterDraw`, and reading "no frame-begin" as "no frame in progress"
  would be wrong.
- **Geometry read here is fresh**, because the compositor has finished. That
  is what makes `visible_region` trustworthy at this point and nowhere earlier.

Textual is a moving target — the repository declares `textual>=0.60`, which
spans several renames — so the probe asserts what it needs at attach time and
declines to attach when an assumption does not hold, rather than publishing a
tree assembled from guesses.
"""

from __future__ import annotations

from typing import Any, Callable, List, Optional
from weakref import WeakKeyDictionary

#: Everything the probe touches on Textual's public surface. Checked once, at
#: attach time, so a version that moved one of them produces a diagnostic
#: instead of a half-built tree.
REQUIRED_APP_ATTRIBUTES = ("post_display_hook", "screen", "focused")

#: What a frame observer is handed: the app, at the instant its frame landed.
FrameObserver = Callable[[Any], None]

_observers: List[FrameObserver] = []
_attached_modules: List[int] = []

#: Frames seen since attach. Only the first is worth a log line — after that
#: the count is a number the producer reports when the session closes.
_frames = 0


def on_frame(observer: FrameObserver) -> None:
    """Register a callback for every completed frame.

    The tree producer registers here; keeping the hook and the producer apart
    is what lets the attachment be tested without a socket.
    """
    _observers.append(observer)


def missing_assumptions(app_class: Any) -> List[str]:
    """Names the probe needs on `App` and did not find.

    Returned rather than raised: the caller decides whether a missing name is
    worth a diagnostic or a refusal, and a probe must never turn a version
    difference into a crashed application.
    """
    return [name for name in REQUIRED_APP_ATTRIBUTES if not hasattr(app_class, name)]


def attach_to_app_module(module: Any) -> bool:
    """Patch `App.post_display_hook` on a freshly imported `textual.app`.

    Returns whether the patch was installed. Idempotent per module object: a
    second import of the same module — or a second probe install — does not
    stack two hooks.
    """
    app_class = getattr(module, "App", None)
    if app_class is None:
        _log("diag", "textual.app has no App class; not attaching")
        return False
    if id(module) in _attached_modules:
        return False

    absent = missing_assumptions(app_class)
    if absent:
        _log(
            "diag",
            "not attaching: this Textual is missing " + ", ".join(absent),
        )
        return False

    original = app_class.post_display_hook

    def post_display_hook(self: Any) -> None:
        # The application's own override runs first and unconditionally: the
        # probe is a guest here, and swallowing the app's hook would be a
        # behaviour change under instrumentation only.
        try:
            original(self)
        finally:
            _notify(self)

    post_display_hook.__doc__ = original.__doc__
    post_display_hook.__name__ = original.__name__
    setattr(app_class, "post_display_hook", post_display_hook)
    _attached_modules.append(id(module))
    _log("sem", f"attached to Textual {_textual_version()}")
    _publish_frames()
    return True


#: One session per application object. Keyed weakly: an app that goes away
#: takes its session with it, and a process may legitimately run several.
_sessions: "WeakKeyDictionary[Any, Any]" = WeakKeyDictionary()


def _publish_frames() -> None:
    """Register the observer that turns frames into published trees."""

    def publish(app: Any) -> None:
        session = _sessions.get(app)
        if session is None:
            from .session import session_for

            session = session_for(app, _textual_version())
            if session is None:
                # Not instrumented after all — nothing to publish to. Recorded
                # so the app is not asked again on every frame.
                _sessions[app] = _DORMANT
                return
            _sessions[app] = session
        if session is not _DORMANT:
            session.on_frame()

    on_frame(publish)


class _Dormant:
    """Marker for an app we already decided not to publish for."""


_DORMANT = _Dormant()


def frames_seen() -> int:
    """How many completed frames the probe has observed."""
    return _frames


def _notify(app: Any) -> None:
    global _frames
    _frames += 1
    if _frames == 1:
        # The one frame worth naming: it proves the hook is live, which is
        # otherwise invisible from outside the process.
        _log("sem", "first frame observed")
    for observer in list(_observers):
        try:
            observer(app)
        except Exception as error:  # pragma: no cover - defensive
            # One bad observer must not stop the others, and must never reach
            # the application's render path.
            _log("diag", f"frame observer failed: {type(error).__name__}: {error}")


def _textual_version() -> str:
    try:
        from importlib.metadata import version

        return version("textual")
    except Exception:
        return "unknown"


_debug: Optional[Any] = None


def _log(category: str, message: str) -> None:
    """Write to the adapter-side diagnostic log, when one is enabled.

    The probe has no terminal to complain to — the application owns it — so
    this file is the only place a refusal to attach can be seen.
    """
    global _debug
    if _debug is None:
        try:
            from termwright.debug import DebugLog

            _debug = DebugLog.from_env(adapter="textual-probe") or False
        except Exception:
            _debug = False
    if _debug:
        _debug.line(category, message)


def reset() -> None:
    """Forget observers and attachments. For tests only."""
    global _frames
    _sessions.clear()
    _observers.clear()
    _attached_modules.clear()
    _frames = 0
