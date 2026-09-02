"""Shared access to the cross-language vectors in ``clients/test-vectors``."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterator

import pytest

from termwright.tree import (
    NodeGeometryObservations,
    Observation,
    Rect,
    SemanticNode,
    SemanticSnapshot,
    framework_evidence,
)

VECTOR_DIR = Path(__file__).resolve().parents[2] / "test-vectors"


def load_vectors(name: str) -> Dict[str, Any]:
    """Load one vector file, e.g. ``load_vectors("marker")``."""
    with (VECTOR_DIR / f"{name}.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def geometry(rect: Rect = Rect(0, 0, 1, 1)) -> NodeGeometryObservations:
    """Known viewport geometry for protocol-v3 unit fixtures."""
    return NodeGeometryObservations(
        displayed=Observation("known", True, evidence=framework_evidence("python-test")),
        intendedRect=Observation("known", rect, evidence=framework_evidence("python-test")),
        visibleRect=Observation("known", rect, evidence=framework_evidence("python-test")),
    )


def node(*, rect: Rect = Rect(0, 0, 1, 1), **fields: Any) -> SemanticNode:
    return SemanticNode(geometry=geometry(rect), **fields)


def snapshot(*, nodes, root_ids, columns: int = 80, rows: int = 24) -> SemanticSnapshot:
    return SemanticSnapshot(
        sessionId="ignored",
        revision=1,
        columns=columns,
        rows=rows,
        rootIds=root_ids,
        nodes=nodes,
        coordinateSpace=Observation("known", "viewport-cells", evidence=framework_evidence("python-test")),
        hitGrid=Observation(
            "unsupported", capability="pointer-hit-grid", reason="framework-unobservable"
        ),
    )


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
