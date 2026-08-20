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


def test_observes_before_existing_application_override_and_only_once():
    events = []
    base = _base(events)

    class ExistingApp(base):
        def post_display_hook(self):
            events.append("application")
            super().post_display_hook()

    textual_probe.reset()
    textual_probe.on_frame(lambda _app: events.append("observation"))
    assert textual_probe.attach_to_app_module(SimpleNamespace(App=base))

    ExistingApp().post_display_hook()

    assert events == ["observation", "application", "base"]


def test_observes_future_subclass_override_without_requiring_super():
    events = []
    base = _base(events)
    textual_probe.reset()
    textual_probe.on_frame(lambda _app: events.append("observation"))
    assert textual_probe.attach_to_app_module(SimpleNamespace(App=base))

    class FutureApp(base):
        def post_display_hook(self):
            events.append("application")

    FutureApp().post_display_hook()

    assert events == ["observation", "application"]
