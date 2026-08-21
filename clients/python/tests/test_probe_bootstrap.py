"""Getting the probe into a process that imports nothing of ours.

These tests run real child interpreters. A bootstrap that works when called
in-process and fails at startup is the only failure mode that matters here, and
only a child process can tell the difference.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from termwright_probe import install, is_instrumented, with_probe, write_bootstrap
from termwright_probe.bootstrap import sitecustomize_source

SRC = str(Path(__file__).resolve().parents[1] / "src")


def run_child(script: str, env: dict, *, args=()) -> subprocess.CompletedProcess:
    """Run `script` in a fresh interpreter with `env`, returning the result."""
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def instrumented_env(tmp_path: Path, **extra: str) -> dict:
    env = dict(os.environ)
    env.update(
        {
            "TERMWRIGHT_ENDPOINT": str(tmp_path / "endpoint.sock"),
            "TERMWRIGHT_TOKEN": "test-token",
        }
    )
    env.update(extra)
    return env


# -- the dormant rule -------------------------------------------------------


def test_dormant_without_both_variables():
    assert is_instrumented({"TERMWRIGHT_ENDPOINT": "/x", "TERMWRIGHT_TOKEN": "t"})
    assert not is_instrumented({"TERMWRIGHT_ENDPOINT": "/x"})
    assert not is_instrumented({"TERMWRIGHT_TOKEN": "t"})
    assert not is_instrumented({})
    assert not is_instrumented({"TERMWRIGHT_ENDPOINT": "", "TERMWRIGHT_TOKEN": ""})


def test_with_probe_writes_nothing_when_dormant():
    """Not even a temporary directory: dormant means dormant."""
    command, env, bootstrap = with_probe(["python", "app.py"], env={"HOME": "/tmp"})
    assert bootstrap is None
    assert command == ["python", "app.py"]
    assert "PYTHONPATH" not in env


def test_the_generated_module_is_inert_without_the_variables(tmp_path):
    """A PYTHONPATH that outlived its run installs nothing.

    The launcher already refuses to inject when dormant; this is the second
    guard, for a directory that ends up somewhere it was not meant to be.
    """
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = dict(os.environ)
        env.pop("TERMWRIGHT_ENDPOINT", None)
        env.pop("TERMWRIGHT_TOKEN", None)
        env = bootstrap.env(env)
        result = run_child(
            """
            import sys
            print(json.dumps({
                'probe_imported': 'termwright_probe' in sys.modules,
                'meta_path': [type(f).__name__ for f in sys.meta_path],
            }))
            """.replace("json.dumps", "__import__('json').dumps"),
            env,
        )
    assert result.returncode == 0, result.stderr
    observed = json.loads(result.stdout)
    assert observed["probe_imported"] is False
    assert "_Waiter" not in observed["meta_path"]


# -- the injection itself ---------------------------------------------------


def test_the_probe_is_installed_before_the_script_runs(tmp_path):
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        result = run_child(
            """
            import sys
            print(__import__('json').dumps({
                'probe_imported': 'termwright_probe' in sys.modules,
                'watching': [type(f).__name__ for f in sys.meta_path],
            }))
            """,
            env,
        )
    assert result.returncode == 0, result.stderr
    observed = json.loads(result.stdout)
    assert observed["probe_imported"] is True, "sitecustomize did not reach the probe"
    assert "_Waiter" in observed["watching"], "nothing is waiting for textual"


def _assert_injected(command: list[str], env: dict, *, cwd: Path | None = None) -> None:
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert result.stdout.strip().splitlines()[-1] == "True", result.stdout


def test_injection_reaches_python_module_and_console_entrypoint(tmp_path):
    module = tmp_path / "probe_entry.py"
    module.write_text("import sys; print('termwright_probe' in sys.modules)\n")
    console = tmp_path / "probe-console"
    console.write_text(f"#!{sys.executable}\nimport sys\nprint('termwright_probe' in sys.modules)\n")
    console.chmod(0o755)
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        env["PYTHONPATH"] = os.pathsep.join([bootstrap.directory, str(tmp_path), SRC])
        _assert_injected([sys.executable, "-m", "probe_entry"], env, cwd=tmp_path)
        _assert_injected([str(console)], env, cwd=tmp_path)


@pytest.mark.parametrize("bypass", ["-S", "-E"])
def test_python_bootstrap_bypass_is_detectable_and_never_fakes_attachment(tmp_path, bypass):
    """These interpreter flags intentionally bypass the sitecustomize hook.

    The driver turns a required semantic contract that never attaches into
    TW_PROBE_ATTACH_FAILED; this process-side regression proves the reason is
    real and deterministic instead of allowing a generic-mode fallback.
    """
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        result = subprocess.run(
            [sys.executable, bypass, "-c", "import sys; print('termwright_probe' in sys.modules)"],
            cwd=tmp_path,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False"


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv is not installed")
def test_injection_reaches_uv_run(tmp_path):
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        _assert_injected([
            "uv", "run", "--no-project", "--python", sys.executable,
            "python", "-c", "import sys; print('termwright_probe' in sys.modules)",
        ], env, cwd=tmp_path)


@pytest.mark.skipif(shutil.which("poetry") is None, reason="Poetry is not installed")
def test_injection_reaches_poetry_run(tmp_path):
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname='termwright-injection-fixture'\nversion='0.0.0'\nrequires-python='>=3.9'\n"
    )
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path, POETRY_VIRTUALENVS_CREATE="false"))
        _assert_injected([
            "poetry", "run", "python", "-c",
            "import sys; print('termwright_probe' in sys.modules)",
        ], env, cwd=tmp_path)


def test_the_script_directory_does_not_shadow_us(tmp_path):
    """Measured in the audit: at sitecustomize time `sys.path[0]` is ours.

    A project that happens to contain its own `sitecustomize.py` is otherwise
    an invisible way for the probe to silently not install.
    """
    project = tmp_path / "project"
    project.mkdir()
    (project / "sitecustomize.py").write_text("RAN_THE_NEIGHBOUR = True\n")
    (project / "app.py").write_text(
        "import sys\n"
        "print(__import__('json').dumps({\n"
        "  'probe': 'termwright_probe' in sys.modules,\n"
        "  'neighbour': hasattr(sys.modules.get('sitecustomize'), 'RAN_THE_NEIGHBOUR'),\n"
        "}))\n"
    )
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        result = subprocess.run(
            [sys.executable, str(project / "app.py")],
            env=env,
            capture_output=True,
            text=True,
            cwd=str(project),
            timeout=60,
        )
    assert result.returncode == 0, result.stderr
    observed = json.loads(result.stdout)
    assert observed["probe"] is True, "the project's own sitecustomize displaced ours"


def test_it_chains_to_the_sitecustomize_it_displaced(tmp_path):
    """Homebrew's CPython ships one that reorders sys.path.

    Shadowing it silently would change import semantics under instrumentation
    only — a bug that looks like the tool caused it and cannot be reproduced
    without it.
    """
    displaced = tmp_path / "displaced"
    displaced.mkdir()
    (displaced / "sitecustomize.py").write_text(
        "import os\nos.environ['DISPLACED_RAN'] = '1'\n"
    )
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = instrumented_env(tmp_path)
        # The displaced one sits *behind* ours, exactly as site-packages does.
        env["PYTHONPATH"] = str(displaced)
        env = bootstrap.env(env)
        result = run_child(
            """
            import os, sys
            print(__import__('json').dumps({
                'displaced_ran': os.environ.get('DISPLACED_RAN'),
                'probe': 'termwright_probe' in sys.modules,
            }))
            """,
            env,
        )
    assert result.returncode == 0, result.stderr
    observed = json.loads(result.stdout)
    assert observed["displaced_ran"] == "1", "the displaced sitecustomize never ran"
    assert observed["probe"] is True, "chaining cost us our own install"


def test_a_broken_displaced_module_does_not_stop_the_application(tmp_path):
    displaced = tmp_path / "displaced"
    displaced.mkdir()
    (displaced / "sitecustomize.py").write_text("raise RuntimeError('boom')\n")
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = instrumented_env(tmp_path)
        env["PYTHONPATH"] = str(displaced)
        env = bootstrap.env(env)
        result = run_child("print('the application ran')", env)
    assert result.returncode == 0, result.stderr
    assert "the application ran" in result.stdout


@pytest.mark.parametrize("flag", ["-S", "-E"])
def test_the_documented_opt_outs_still_opt_out(tmp_path, flag):
    """`-S` skips `site` entirely and `-E` ignores PYTHONPATH.

    Both are the person running the interpreter saying no. The probe must not
    find a way around that, and the README says so.
    """
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        result = subprocess.run(
            [sys.executable, flag, "-c", "import sys; print('termwright_probe' in sys.modules)"],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False"


def test_pythonpath_is_prepended_not_replaced():
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env({"PYTHONPATH": "/somewhere/else"})
        entries = env["PYTHONPATH"].split(os.pathsep)
    assert entries[0] == bootstrap.directory
    assert "/somewhere/else" in entries


def test_the_directory_is_removed_on_cleanup():
    bootstrap = write_bootstrap(package_root=SRC)
    assert os.path.exists(bootstrap.sitecustomize)
    bootstrap.cleanup()
    assert not os.path.exists(bootstrap.directory)
    bootstrap.cleanup()  # twice is fine


def test_nothing_is_written_into_the_project(tmp_path):
    """Zero-config means the project is untouched, not merely unmodified-ish."""
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text("print('ok')\n")
    before = sorted(path.name for path in project.iterdir())

    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        subprocess.run(
            [sys.executable, str(project / "app.py")],
            env=env,
            capture_output=True,
            text=True,
            cwd=str(project),
            timeout=60,
        )
    assert sorted(path.name for path in project.iterdir()) == before


def test_the_generated_source_names_no_secret(tmp_path):
    source = sitecustomize_source(package_root=SRC)
    assert "TERMWRIGHT_TOKEN" in source, "the dormancy check must be in the file"
    # The variable is read at runtime; its value must never be baked in.
    assert "test-token" not in source


def test_install_is_idempotent_and_dormant_by_default():
    import termwright_probe

    termwright_probe._installed = False
    try:
        assert install(env={}) is False
        assert install(env={"TERMWRIGHT_ENDPOINT": "/x", "TERMWRIGHT_TOKEN": "t"}) is True
        assert install(env={"TERMWRIGHT_ENDPOINT": "/x", "TERMWRIGHT_TOKEN": "t"}) is False
    finally:
        termwright_probe._installed = False
        from termwright_probe import defer

        defer.reset()


# -- end to end, on an application that never heard of us -------------------


FIXTURE = Path(__file__).parent / "fixtures" / "vanilla_textual_app.py"


@pytest.mark.skipif(
    not FIXTURE.exists(), reason="the zero-config fixture is missing"
)
def test_it_attaches_to_a_vanilla_textual_app(tmp_path):
    """The whole point, in one test.

    A perfectly ordinary Textual application — no import of termwright, no
    adapter, no configuration — is launched through the bootstrap, and the
    probe attaches and sees frames. The diagnostic log is how we can tell from
    outside the process; the application's own stdout is the terminal and must
    stay untouched.
    """
    pytest.importorskip("textual", reason="the probe needs Textual to attach to")
    log = tmp_path / "probe.log"
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path, TERMWRIGHT_DEBUG_FILE=str(log)))
        # A driver, because there is no terminal here. The application does not
        # know: it is chosen from the environment, like everything else.
        env["TEXTUAL_DRIVER"] = "textual.drivers.headless_driver:HeadlessDriver"
        result = subprocess.run(
            [sys.executable, str(FIXTURE)],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert log.exists(), "the probe wrote no diagnostics at all"
    text = log.read_text()
    assert "attached to Textual" in text, text
    assert "first frame observed" in text, text


@pytest.mark.skipif(not FIXTURE.exists(), reason="the zero-config fixture is missing")
def test_the_same_app_is_untouched_without_instrumentation(tmp_path):
    """Dormant means the application cannot tell the difference."""
    pytest.importorskip("textual")
    log = tmp_path / "probe.log"
    env = dict(os.environ)
    env.pop("TERMWRIGHT_ENDPOINT", None)
    env.pop("TERMWRIGHT_TOKEN", None)
    env["TERMWRIGHT_DEBUG_FILE"] = str(log)
    env["TEXTUAL_DRIVER"] = "textual.drivers.headless_driver:HeadlessDriver"
    env["PYTHONPATH"] = SRC
    result = subprocess.run(
        [sys.executable, str(FIXTURE)],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert not log.exists(), "a dormant run still produced diagnostics"


def test_the_fixture_imports_nothing_of_ours():
    """Guards the fixture itself: it is only evidence while it stays vanilla.

    Read from the syntax tree, not by grepping the text — the file's own
    docstring says the word "termwright" several times, and a test that cannot
    tell a comment from an import is a test that will be silenced the first
    time it cries wolf.
    """
    import ast

    tree = ast.parse(FIXTURE.read_text())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)

    ours = sorted(name for name in imported if name.split(".")[0].startswith("termwright"))
    assert ours == [], f"the zero-config fixture imports {ours}"
    assert any(name.startswith("textual") for name in imported), "the fixture is not a Textual app"


def test_the_probe_does_not_import_textual_before_the_application(tmp_path):
    """Startup injection waits for the application to choose its framework."""
    with write_bootstrap(package_root=SRC) as bootstrap:
        env = bootstrap.env(instrumented_env(tmp_path))
        result = run_child(
            """
            import sys
            print(__import__('json').dumps(sorted(
                name for name in sys.modules
                if name.startswith('termwright') or name.startswith('textual')
            )))
            """,
            env,
        )
    assert result.returncode == 0, result.stderr
    loaded = json.loads(result.stdout)
    assert not any(name.startswith("textual") for name in loaded), (
        f"the probe imported the framework before the application did: {loaded}"
    )
