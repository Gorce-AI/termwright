"""What the terminal receives, with and without the probe.

The dormant rule is a claim about bytes: an application that was not asked to
be instrumented must render exactly what it would have rendered alone. And an
application that *was* asked must render exactly the same thing plus the
markers — the probe observes, it does not redraw.

Both are only checkable on a real terminal. Textual's headless driver writes
nothing at all, so a test comparing its output would compare two empty strings
and pass forever; these tests run the application on a pty instead, where the
same fixture emits about 11 kB of escape sequences.
"""

from __future__ import annotations

import asyncio
import os
import re
import select
import subprocess
import sys
import time
from pathlib import Path

import pytest

pytest.importorskip("textual", reason="the golden runs need Textual")

from termwright_probe import write_bootstrap  # noqa: E402

from test_client import FakeDriver, TOKEN  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "vanilla_textual_app.py"
SRC = str(Path(__file__).resolve().parents[1] / "src")

#: `ESC ] 8487 ; … BEL` (or ST). What the probe adds and nothing else does.
MARKER = re.compile(rb"\x1b\]8487;[^\x07\x1b]*(?:\x07|\x1b\\)")

pytestmark = pytest.mark.skipif(
    not hasattr(os, "openpty"), reason="no pty on this platform"
)


def run_on_pty(env: dict, *, timeout: float = 30.0) -> bytes:
    """Run the fixture with a pty for a terminal and return every byte it wrote."""
    primary, secondary = os.openpty()
    os.set_blocking(primary, False)
    process = subprocess.Popen(
        [sys.executable, str(FIXTURE)],
        stdin=secondary,
        stdout=secondary,
        stderr=secondary,
        env=env,
        close_fds=True,
    )
    os.close(secondary)
    chunks = []
    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([primary], [], [], 0.1)
            if ready:
                try:
                    data = os.read(primary, 65536)
                except OSError:
                    break
                if not data:
                    break
                chunks.append(data)
            elif process.poll() is not None:
                break
        process.wait(timeout=5)
    finally:
        if process.poll() is None:
            process.kill()
        os.close(primary)
    return b"".join(chunks)


def terminal_env(**extra: str) -> dict:
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    for name in ("TERMWRIGHT_ENDPOINT", "TERMWRIGHT_TOKEN", "TERMWRIGHT_DEBUG_FILE"):
        env.pop(name, None)
    env.update(extra)
    return env


def test_the_fixture_is_deterministic():
    """The premise every comparison below rests on, checked rather than assumed."""
    first = run_on_pty(terminal_env())
    second = run_on_pty(terminal_env())
    assert first == second, "the fixture is not byte-stable; the goldens mean nothing"
    assert len(first) > 1000, f"only {len(first)} bytes: is anything rendering?"


def test_a_dormant_probe_changes_not_one_byte():
    """The dormant rule, as bytes.

    The bootstrap is on PYTHONPATH — the generated sitecustomize runs, and the
    probe module is reachable — but with no endpoint and no token nothing is
    installed, and the terminal receives exactly what it would have received
    with no termwright on the machine at all.
    """
    baseline = run_on_pty(terminal_env())
    with write_bootstrap(package_root=SRC) as bootstrap:
        instrumented_path = run_on_pty(bootstrap.env(terminal_env()))
    assert instrumented_path == baseline


async def test_instrumented_output_is_the_same_render_plus_markers(endpoint):
    """The probe observes; it must not redraw.

    Strip the render-commit markers and the byte stream is the baseline again.
    Anything else would mean instrumentation changed what the user sees, which
    is the one thing a test harness must never do.
    """
    baseline = await asyncio.to_thread(run_on_pty, terminal_env())

    driver = FakeDriver(endpoint)
    await driver.start()
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(
            terminal_env(TERMWRIGHT_ENDPOINT=endpoint, TERMWRIGHT_TOKEN=TOKEN)
        )
        observed = await asyncio.to_thread(run_on_pty, env)

    markers = MARKER.findall(observed)
    assert markers, "an instrumented run committed no revision at all"
    assert MARKER.sub(b"", observed) == baseline, (
        "instrumentation changed the render, not just the commits"
    )

    published = [m for m in driver.received if m.get("type") == "snapshot"]
    assert published, "markers were written but no tree was published"
