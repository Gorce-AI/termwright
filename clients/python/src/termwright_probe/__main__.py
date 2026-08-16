"""Launcher: `python -m termwright_probe -- <command>`.

Composes the instrumented environment and execs the command in it, so a driver
can prefix any Python invocation without knowing where the probe is installed.

Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` the command runs exactly
as it would have: no directory is created and no variable is added. That makes
the launcher safe to leave in a wrapper script that is also used outside tests.
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import List, Sequence

from .bootstrap import with_probe

USAGE = "usage: python -m termwright_probe [--] <command> [args...]"


def main(argv: Sequence[str]) -> int:
    arguments: List[str] = list(argv)
    if arguments and arguments[0] == "--":
        arguments = arguments[1:]
    if not arguments:
        print(USAGE, file=sys.stderr)
        return 2

    command, env, bootstrap = with_probe(arguments)
    try:
        # subprocess rather than execve: the ephemeral directory has to
        # outlive the child, and an exec would drop our chance to remove it.
        return subprocess.call(command, env=env)
    except FileNotFoundError:
        print(f"termwright: cannot run {command[0]!r}", file=sys.stderr)
        return 127
    finally:
        if bootstrap is not None:
            bootstrap.cleanup()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
