"""Shared access to the cross-language vectors in ``clients/test-vectors``."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterator

import pytest

VECTOR_DIR = Path(__file__).resolve().parents[2] / "test-vectors"


def load_vectors(name: str) -> Dict[str, Any]:
    """Load one vector file, e.g. ``load_vectors("marker")``."""
    with (VECTOR_DIR / f"{name}.json").open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def endpoint() -> Iterator[str]:
    """A unix socket path short enough for the 104-byte ``sockaddr_un`` limit.

    pytest's ``tmp_path`` is nested too deeply on macOS to bind against.
    """
    directory = tempfile.mkdtemp(prefix="tw-")
    try:
        yield str(Path(directory) / "s")
    finally:
        shutil.rmtree(directory, ignore_errors=True)
