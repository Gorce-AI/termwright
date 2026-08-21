"""The Textual frame hook is an atomic observation boundary."""

from types import SimpleNamespace

from termwright_probe import textual_probe


def _base(events):
    class FakeApp:
        screen = object()
        focused = None

        @classmethod
        def __init_subclass__(cls, **kwargs):
            return super().__init_subclass__(**kwargs)

        def post_display_hook(self):
            events.append("base")

    return FakeApp


def test_observes_before_existing_application_override_and_only_once(monkeypatch):
    events = []
    base = _base(events)

    class ExistingApp(base):
        def post_display_hook(self):
            events.append("application")
            super().post_display_hook()

    textual_probe.reset()
    monkeypatch.setattr(textual_probe, "_textual_version", lambda: "8.2.8")
    textual_probe.on_frame(lambda _app: events.append("observation"))
    assert textual_probe.attach_to_app_module(SimpleNamespace(App=base))

    ExistingApp().post_display_hook()

    assert events == ["observation", "application", "base"]


def test_observes_future_subclass_override_without_requiring_super(monkeypatch):
    events = []
    base = _base(events)
    textual_probe.reset()
    monkeypatch.setattr(textual_probe, "_textual_version", lambda: "8.2.8")
    textual_probe.on_frame(lambda _app: events.append("observation"))
    assert textual_probe.attach_to_app_module(SimpleNamespace(App=base))

    class FutureApp(base):
        def post_display_hook(self):
            events.append("application")

    FutureApp().post_display_hook()

    assert events == ["observation", "application"]


def test_unknown_textual_version_never_gets_strong_instrumentation(monkeypatch):
    events = []
    base = _base(events)
    textual_probe.reset()
    monkeypatch.setattr(textual_probe, "_textual_version", lambda: "99.1.0")

    assert not textual_probe.attach_to_app_module(SimpleNamespace(App=base))
    base().post_display_hook()
    assert events == ["base"]


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
    assert not textual_probe.is_textual_version_certified(
        "99.1.1", valid
    )
