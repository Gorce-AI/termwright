"""The exact Textual display commit boundary."""

from types import SimpleNamespace
from queue import Full, Queue

import pytest

from termwright_probe import textual_probe


class Driver:
    is_headless = False

    def __init__(self, events, *, write_error=False, flush_error=False):
        self.events = events
        self.write_error = write_error
        self.flush_error = flush_error
        self._writer_thread = SimpleNamespace(
            _queue=Queue(maxsize=30), is_alive=lambda: True
        )

    def write(self, text):
        self.events.append(("write", text))
        if self.write_error:
            raise OSError("write failed")
        self._writer_thread._queue.put(text)

    def flush(self):
        self.events.append(("flush", None))
        if self.flush_error:
            raise OSError("flush failed")


def _base(events):
    class FakeApp:
        screen = object()
        focused = None
        size = SimpleNamespace(width=80, height=24)
        _driver = None
        _exception = None
        _running = True
        _closed = False
        _batch_count = 0

        @classmethod
        def __init_subclass__(cls, **kwargs):
            return super().__init_subclass__(**kwargs)

        def __init__(self, driver=None):
            self._driver = driver or Driver(events)

        def refresh(self):
            events.append(("refresh", None))

        def post_display_hook(self):
            events.append(("base", None))

        def _display(self, screen, renderable):
            try:
                if (
                    renderable is None
                    or self._batch_count
                    or not self._running
                    or self._closed
                ):
                    return
                if callable(renderable):
                    renderable()
                self._driver.write(str(renderable))
                self._driver.flush()
            except Exception as error:
                self._exception = error
            finally:
                self.post_display_hook()

    return FakeApp


@pytest.fixture(autouse=True)
def _isolated_probe(monkeypatch):
    textual_probe.reset()
    monkeypatch.setattr(
        textual_probe, "_is_certified_builtin_driver", lambda driver: type(driver) is Driver
    )
    monkeypatch.setattr(
        textual_probe,
        "_is_certified_writer_thread",
        lambda writer: (
            writer is not None
            and type(getattr(writer, "_queue", None)) is Queue
            and writer._queue.maxsize == 30
        ),
    )
    yield
    textual_probe.reset()


def _attach(monkeypatch, base, observations):
    monkeypatch.setattr(textual_probe, "_textual_version", lambda: "8.2.8")
    textual_probe.on_frame(observations.append)
    assert textual_probe.attach_to_app_module(SimpleNamespace(App=base))


def test_observes_only_after_successful_write_and_flush(monkeypatch):
    events = []
    observations = []
    base = _base(events)
    _attach(monkeypatch, base, observations)
    app = base()

    app._display(app.screen, "frame")

    assert events == [("write", "frame"), ("flush", None), ("base", None)]
    assert len(observations) == 1
    commit = observations[0]
    assert commit.app is app
    assert commit.screen is app.screen
    assert commit.driver is app._driver
    commit.enqueue_marker("marker")
    assert [app._driver._writer_thread._queue.get_nowait() for _ in range(2)] == [
        "frame", "marker"
    ]


def test_marker_enqueue_is_bounded_and_never_waits_for_queue_capacity():
    driver = Driver([])
    marker_writer = textual_probe._marker_writer_for(driver)
    assert marker_writer is not None
    for index in range(30):
        driver._writer_thread._queue.put_nowait(str(index))

    with pytest.raises(RuntimeError, match="full before snapshot"):
        marker_writer.preflight()
    with pytest.raises(Full):
        marker_writer.enqueue("marker")


@pytest.mark.parametrize("condition", ["custom", "inline", "missing", "stopped", "replaced"])
def test_write_confirmed_but_uncertified_writer_emits_typed_failure(monkeypatch, condition):
    events = []
    observations = []
    base = _base(events)
    _attach(monkeypatch, base, observations)
    app = base()
    original_writer = app._driver._writer_thread
    if condition == "custom":
        monkeypatch.setattr(textual_probe, "_is_certified_builtin_driver", lambda _driver: False)
    elif condition == "inline":
        app._driver.is_inline = True
    elif condition == "missing":
        monkeypatch.setattr(textual_probe, "_is_certified_writer_thread", lambda _writer: False)
    elif condition == "stopped":
        original_writer.is_alive = lambda: False
    else:
        original_flush = app._driver.flush

        def replace_after_write():
            original_flush()
            app._driver._writer_thread = SimpleNamespace(
                _queue=Queue(maxsize=30), is_alive=lambda: True
            )
        app._driver.flush = replace_after_write
        app._display(app.screen, "frame")

    if condition != "replaced":
        app._display(app.screen, "frame")

    assert len(observations) == 1
    failure = observations[0]
    assert isinstance(failure, textual_probe.TextualCommitFailure)
    assert failure.detail


@pytest.mark.parametrize("condition", ["none", "batch", "stopped", "closed", "headless"])
def test_early_return_and_headless_paths_do_not_commit(monkeypatch, condition):
    events = []
    observations = []
    base = _base(events)
    _attach(monkeypatch, base, observations)
    app = base()
    renderable = "frame"
    if condition == "none":
        renderable = None
    elif condition == "batch":
        app._batch_count = 1
    elif condition == "stopped":
        app._running = False
    elif condition == "closed":
        app._closed = True
    else:
        app._driver.is_headless = True

    app._display(app.screen, renderable)

    assert observations == []


@pytest.mark.parametrize("failure", ["render", "write", "flush"])
def test_failed_display_never_commits_partial_state(monkeypatch, failure):
    events = []
    observations = []
    base = _base(events)
    driver = Driver(events, write_error=failure == "write", flush_error=failure == "flush")
    app = base(driver)
    _attach(monkeypatch, base, observations)

    def broken_render():
        raise ValueError("render failed")

    app._display(app.screen, broken_render if failure == "render" else "frame")

    assert observations == []


def test_manual_hook_call_is_not_commit_evidence(monkeypatch):
    events = []
    observations = []
    base = _base(events)
    _attach(monkeypatch, base, observations)

    base().post_display_hook()

    assert observations == []


def test_subclass_super_hook_observes_exactly_once_before_app_mutation(monkeypatch):
    events = []
    observations = []
    base = _base(events)

    class ExistingApp(base):
        def post_display_hook(self):
            events.append(("application", None))
            super().post_display_hook()

    _attach(monkeypatch, base, observations)
    textual_probe.on_frame(lambda _commit: events.append(("observation", None)))
    app = ExistingApp()
    app._display(app.screen, "frame")

    assert len(observations) == 1
    assert events == [
        ("write", "frame"), ("flush", None),
        ("observation", None), ("application", None), ("base", None),
    ]


def test_successful_display_inside_outer_exception_still_commits(monkeypatch):
    events = []
    observations = []
    base = _base(events)
    _attach(monkeypatch, base, observations)
    app = base()

    try:
        raise LookupError("outer")
    except LookupError:
        app._display(app.screen, "frame")

    assert len(observations) == 1


@pytest.mark.parametrize(
    ("replacement", "detail"),
    [
        ("screen", "replaced the screen"),
        ("driver", "replaced the driver"),
    ],
)
def test_commit_identity_change_is_a_typed_failure(monkeypatch, replacement, detail):
    events = []
    observations = []
    base = _base(events)
    _attach(monkeypatch, base, observations)
    app = base()

    def replace_during_render():
        if replacement == "screen":
            app.screen = object()
        else:
            app._driver = Driver(events)

    app._display(app.screen, replace_during_render)

    assert len(observations) == 1
    failure = observations[0]
    assert isinstance(failure, textual_probe.TextualCommitFailure)
    assert detail in failure.detail


def test_unknown_textual_version_never_gets_strong_instrumentation(monkeypatch):
    events = []
    base = _base(events)
    textual_probe.reset()
    monkeypatch.setattr(textual_probe, "_textual_version", lambda: "99.1.0")
    assert not textual_probe.attach_to_app_module(SimpleNamespace(App=base))


def test_reset_restores_every_mutated_descriptor_by_identity(monkeypatch):
    events = []
    observations = []
    base = _base(events)
    original_display = base.__dict__["_display"]
    original_hook = base.__dict__["post_display_hook"]
    original_init_subclass = base.__dict__["__init_subclass__"]
    original_write = Driver.__dict__["write"]
    _attach(monkeypatch, base, observations)

    def future_hook(self):
        events.append(("future", None))

    class FutureApp(base):
        post_display_hook = future_hook

    app = FutureApp()
    app._display(app.screen, "frame")
    assert base.__dict__["_display"] is not original_display
    assert base.__dict__["post_display_hook"] is not original_hook
    assert Driver.__dict__["write"] is not original_write
    assert FutureApp.__dict__["post_display_hook"] is not future_hook

    textual_probe.reset()

    assert base.__dict__["_display"] is original_display
    assert base.__dict__["post_display_hook"] is original_hook
    assert base.__dict__["__init_subclass__"] is original_init_subclass
    assert Driver.__dict__["write"] is original_write
    assert FutureApp.__dict__["post_display_hook"] is future_hook


def test_reset_restores_real_textual_app_and_driver_descriptors(monkeypatch):
    from textual.app import App
    from textual.drivers.linux_driver import LinuxDriver

    textual_probe.reset()
    monkeypatch.setattr(textual_probe, "_textual_version", lambda: "8.2.8")
    monkeypatch.setattr(
        textual_probe,
        "_is_certified_builtin_driver",
        lambda driver: type(driver) is LinuxDriver,
    )
    original_display = App.__dict__["_display"]
    original_hook = App.__dict__["post_display_hook"]
    original_init_subclass = App.__dict__["__init_subclass__"]
    original_write = LinuxDriver.__dict__["write"]

    assert textual_probe.attach_to_app_module(SimpleNamespace(App=App))
    driver = LinuxDriver.__new__(LinuxDriver)
    assert textual_probe._prepare_driver(driver) is not None

    textual_probe.reset()

    assert App.__dict__["_display"] is original_display
    assert App.__dict__["post_display_hook"] is original_hook
    assert App.__dict__["__init_subclass__"] is original_init_subclass
    assert LinuxDriver.__dict__["write"] is original_write


def test_candidate_override_is_exact_digest_and_revision_bound():
    digest = "sha256:" + "a" * 64
    revision = "b" * 40
    valid = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_SHA": revision,
        "TERMWRIGHT_CERTIFICATION_TEXTUAL_VERSION": "99.1.0",
        "TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST": digest,
        "TERMWRIGHT_CERTIFICATION_SOURCE_REVISION": revision,
    }
    assert textual_probe.is_textual_version_certified("99.1.0", valid)
    assert not textual_probe.is_textual_version_certified(
        "99.1.0", {**valid, "TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST": "sha256:tampered"}
    )
    assert not textual_probe.is_textual_version_certified(
        "99.1.0", {**valid, "TERMWRIGHT_CERTIFICATION_SOURCE_REVISION": "c" * 40}
    )
    assert not textual_probe.is_textual_version_certified("99.1.1", valid)
