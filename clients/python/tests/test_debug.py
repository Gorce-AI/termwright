"""The adapter-side diagnostic log: off by default, a file when asked, never stderr.

Tests that need a running loop are ``async def`` and rely on this package's
``asyncio_mode = "auto"``. Do not reach for ``asyncio.run`` here: on Python 3.9
it calls ``set_event_loop(None)`` on the way out, which leaves every later test
in the session without a current loop — including the Textual ones, which fail
with ``RuntimeError: There is no current event loop`` for a reason that has
nothing to do with them.
"""

from __future__ import annotations

import os
import sys

import pytest

from termwright import DebugLog, client_from_env, debug_path
from termwright.debug import describe_endpoint


def test_off_without_any_variable(tmp_path):
    assert debug_path({}) is None
    assert DebugLog.from_env({}) is None


@pytest.mark.parametrize("value", ["", "1", "true", "on", "api", "all", "0", "false", "off", "ALL"])
def test_the_drivers_own_switches_do_not_name_a_file(value):
    """`TERMWRIGHT_DEBUG=1` reaches the child too; it must not turn this on.

    The driver logs to stderr, which the adapter cannot do — the app owns the
    terminal — so a switch with no destination leaves the adapter silent.
    """
    assert debug_path({"TERMWRIGHT_DEBUG": value}) is None


def test_a_path_in_either_variable_enables_it(tmp_path):
    target = tmp_path / "adapter.log"
    assert debug_path({"TERMWRIGHT_DEBUG": str(target)}) == str(target)
    assert debug_path({"TERMWRIGHT_DEBUG_FILE": str(target)}) == str(target)


def test_the_file_variable_wins(tmp_path):
    chosen = tmp_path / "chosen.log"
    assert (
        debug_path({"TERMWRIGHT_DEBUG": "/other.log", "TERMWRIGHT_DEBUG_FILE": str(chosen)})
        == str(chosen)
    )


def test_lines_carry_category_label_and_elapsed_time(tmp_path):
    target = tmp_path / "adapter.log"
    log = DebugLog.from_env({"TERMWRIGHT_DEBUG_FILE": str(target)}, adapter="test-adapter")
    assert log is not None
    log.line("sem", "hello sent")
    log.label = "abcdef0123456789"
    log.line("io", "r1 snapshot nodes=3")
    log.close()

    lines = target.read_text().splitlines()
    assert lines[0].startswith("  tw:diag ")
    assert "adapter=test-adapter" in lines[0]
    assert f"pid={os.getpid()}" in lines[0]
    assert lines[1].startswith(f"  tw:sem  [p{os.getpid()}]")
    assert lines[1].endswith("s hello sent")
    # The session id replaces the pid once the handshake supplies one, and is
    # truncated to the driver's eight characters so both logs align.
    assert lines[2].startswith("  tw:io   [abcdef01]")


def test_it_appends_rather_than_truncating(tmp_path):
    target = tmp_path / "adapter.log"
    target.write_text("earlier run\n")
    log = DebugLog.from_env({"TERMWRIGHT_DEBUG_FILE": str(target)})
    assert log is not None
    log.line("diag", "later run")
    log.close()
    assert target.read_text().startswith("earlier run\n")
    assert "later run" in target.read_text()


def test_an_unwritable_path_disables_the_log_without_raising(tmp_path):
    """A diagnostic that can break the application is worse than none."""
    unwritable = tmp_path / "no-such-directory" / "adapter.log"
    assert DebugLog.from_env({"TERMWRIGHT_DEBUG_FILE": str(unwritable)}) is None


def test_writing_after_the_file_is_closed_is_silent(tmp_path):
    log = DebugLog.from_env({"TERMWRIGHT_DEBUG_FILE": str(tmp_path / "a.log")})
    assert log is not None
    log.close()
    log.line("diag", "after close")  # must not raise
    log.close()


def test_nothing_reaches_stderr(tmp_path, capsys):
    log = DebugLog.from_env({"TERMWRIGHT_DEBUG_FILE": str(tmp_path / "a.log")})
    assert log is not None
    log.line("diag", "a line")
    log.close()
    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out == ""


def test_describe_endpoint_names_the_transport():
    assert describe_endpoint("/tmp/tw.sock").startswith("unix:")
    assert describe_endpoint("\\\\.\\pipe\\termwright-ab12").startswith("pipe:")


# -- the reason for staying dormant ---------------------------------------


def test_dormancy_reason_is_recorded(tmp_path):
    """The line that explains a run where the adapter never attached."""
    target = tmp_path / "adapter.log"
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.0.0",
        env={"TERMWRIGHT_DEBUG_FILE": str(target)},
    )
    assert client is None
    text = target.read_text()
    assert "dormant: TERMWRIGHT_ENDPOINT and TERMWRIGHT_TOKEN not set" in text


def test_dormancy_reason_names_only_the_missing_variable(tmp_path):
    target = tmp_path / "adapter.log"
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.0.0",
        env={"TERMWRIGHT_DEBUG_FILE": str(target), "TERMWRIGHT_ENDPOINT": "/tmp/x.sock"},
    )
    assert client is None
    assert "dormant: TERMWRIGHT_TOKEN not set" in target.read_text()


def test_a_protocol_mismatch_says_so(tmp_path):
    target = tmp_path / "adapter.log"
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.0.0",
        env={
            "TERMWRIGHT_DEBUG_FILE": str(target),
            "TERMWRIGHT_ENDPOINT": "/tmp/x.sock",
            "TERMWRIGHT_TOKEN": "s3cret",
            "TERMWRIGHT_PROTOCOL": "termwright/99",
        },
    )
    assert client is None
    assert "dormant: TERMWRIGHT_PROTOCOL='termwright/99'" in target.read_text()


async def test_the_token_never_appears(tmp_path):
    target = tmp_path / "adapter.log"
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.0.0",
        env={
            "TERMWRIGHT_DEBUG_FILE": str(target),
            "TERMWRIGHT_ENDPOINT": "/tmp/does-not-exist.sock",
            "TERMWRIGHT_TOKEN": "s3cret-token-value",
        },
    )
    assert client is not None
    assert await client.start(timeout=0.5) is False
    assert "s3cret-token-value" not in target.read_text()


@pytest.mark.skipif(sys.platform == "win32", reason="unix socket path")
async def test_a_failed_dial_names_the_error_class(tmp_path, endpoint):
    """The line that would have settled the Windows question by itself.

    ``endpoint`` rather than ``tmp_path`` for the socket: a path under pytest's
    temporary directory is longer than ``sockaddr_un`` allows on macOS, and
    would fail with the wrong error for the wrong reason.
    """
    target = tmp_path / "adapter.log"
    client = client_from_env(
        adapter_name="test",
        adapter_version="0.0.0",
        env={
            "TERMWRIGHT_DEBUG_FILE": str(target),
            "TERMWRIGHT_ENDPOINT": endpoint,
            "TERMWRIGHT_TOKEN": "token",
        },
    )
    assert client is not None
    assert await client.start(timeout=0.5) is False
    text = target.read_text()
    assert "dial unix:" in text
    assert "dial failed, staying dormant: FileNotFoundError" in text


def test_a_dormant_process_creates_no_file(tmp_path, monkeypatch):
    """The dormant rule covers the diagnostic too: unasked, it does not exist."""
    monkeypatch.delenv("TERMWRIGHT_DEBUG", raising=False)
    monkeypatch.delenv("TERMWRIGHT_DEBUG_FILE", raising=False)
    monkeypatch.chdir(tmp_path)
    assert (
        client_from_env(adapter_name="test", adapter_version="0.0.0", env={}) is None
    )
    assert list(tmp_path.iterdir()) == []
