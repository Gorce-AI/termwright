"""termwright probe for Textual — semantics from an app that imports nothing of ours.

The application is launched with one extra environment variable. CPython's
startup imports a generated `sitecustomize`, which installs this probe, which
waits for the application to import Textual and attaches to it there. Nothing
is written into the project, no configuration file is needed, and the
application's source is untouched.

**Dormant without instrumentation.** With no `TERMWRIGHT_ENDPOINT` and
`TERMWRIGHT_TOKEN` in the environment the probe installs nothing at all — no
import hook, no patch, no socket — so a `PYTHONPATH` that outlived the run it
was written for is inert.

The probe depends on the protocol half of `termwright` (framing, marker,
messages, validation, client) and on the metadata-only Textual annotation SDK.
It does not import Textual until the application itself chooses to.
"""

from __future__ import annotations

import os
from typing import Mapping, Optional

from .bootstrap import (
    ENV_ENDPOINT,
    ENV_TOKEN,
    Bootstrap,
    is_instrumented,
    with_probe,
    write_bootstrap,
)
from .defer import when_imported

__version__ = "0.1.0"

#: Set once :func:`install` has run, so a second `sitecustomize` on the path
#: cannot attach the probe twice.
_installed = False


def install(env: Optional[Mapping[str, str]] = None) -> bool:
    """Attach the probe to Textual, as soon as the application imports it.

    Returns whether anything was installed. Safe to call more than once, and
    safe to call in a process that never imports Textual: all that happens
    then is one finder sitting unused on `sys.meta_path`.
    """
    global _installed
    source: Mapping[str, str] = os.environ if env is None else env
    if _installed or not is_instrumented(source):
        return False
    _installed = True

    def attach(module: object) -> None:
        from .textual_probe import attach_to_app_module

        attach_to_app_module(module)

    when_imported("textual.app", attach)
    return True


__all__ = [
    "Bootstrap",
    "ENV_ENDPOINT",
    "ENV_TOKEN",
    "__version__",
    "install",
    "is_instrumented",
    "when_imported",
    "with_probe",
    "write_bootstrap",
]
