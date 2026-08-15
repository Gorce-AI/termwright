"""Semantic tree DTOs.

These mirror ``@termwright/protocol``'s ``tree.ts``. ``to_wire`` drops unset
optionals, because the wire schema is strict: an explicit ``null`` is a
validation failure, not "absent".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Union


@dataclass(frozen=True)
class Rect:
    """Zero-based viewport cell coordinates."""

    row: int
    column: int
    width: int
    height: int

    def to_wire(self) -> Dict[str, int]:
        return {"row": self.row, "column": self.column, "width": self.width, "height": self.height}


@dataclass(frozen=True)
class SemanticState:
    """Closed state set; unset members are omitted from the wire form."""

    disabled: Optional[bool] = None
    focused: Optional[bool] = None
    selected: Optional[bool] = None
    checked: Optional[Union[bool, str]] = None
    expanded: Optional[bool] = None
    modal: Optional[bool] = None
    busy: Optional[bool] = None
    hidden: Optional[bool] = None
    readonly: Optional[bool] = None
    multiline: Optional[bool] = None
    orientation: Optional[str] = None
    level: Optional[int] = None
    positionInSet: Optional[int] = None
    setSize: Optional[int] = None
    scrollOffset: Optional[int] = None
    scrollExtent: Optional[int] = None

    def to_wire(self) -> Dict[str, Any]:
        return {
            name: value
            for name, value in self.__dict__.items()
            if value is not None
        }


@dataclass(frozen=True)
class SemanticTextRange:
    """Maps grapheme offsets of a node's text onto cell coordinates."""

    startOffset: int
    endOffset: int
    rect: Rect

    def to_wire(self) -> Dict[str, Any]:
        return {
            "startOffset": self.startOffset,
            "endOffset": self.endOffset,
            "rect": self.rect.to_wire(),
        }


@dataclass(frozen=True)
class SemanticNode:
    """One accessible node. ``bounds`` are absolute viewport cells."""

    id: str
    role: str
    name: str = ""
    parentId: Optional[str] = None
    description: Optional[str] = None
    value: Optional[str] = None
    bounds: Optional[Rect] = None
    state: Optional[SemanticState] = None
    actions: Optional[Sequence[str]] = None
    labelledBy: Optional[Sequence[str]] = None
    describedBy: Optional[Sequence[str]] = None
    textRanges: Optional[Sequence[SemanticTextRange]] = None
    testId: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {"id": self.id, "role": self.role, "name": self.name}
        if self.parentId is not None:
            wire["parentId"] = self.parentId
        if self.description is not None:
            wire["description"] = self.description
        if self.value is not None:
            wire["value"] = self.value
        if self.bounds is not None:
            wire["bounds"] = self.bounds.to_wire()
        if self.state is not None:
            state = self.state.to_wire()
            if state:
                wire["state"] = state
        if self.actions is not None:
            wire["actions"] = list(self.actions)
        if self.labelledBy is not None:
            wire["labelledBy"] = list(self.labelledBy)
        if self.describedBy is not None:
            wire["describedBy"] = list(self.describedBy)
        if self.textRanges is not None:
            wire["textRanges"] = [item.to_wire() for item in self.textRanges]
        if self.testId is not None:
            wire["testId"] = self.testId
        return wire


@dataclass(frozen=True)
class CursorInfo:
    """Terminal cursor position, in viewport cells."""

    row: int
    column: int
    visible: bool
    shape: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {"row": self.row, "column": self.column, "visible": self.visible}
        if self.shape is not None:
            wire["shape"] = self.shape
        return wire


@dataclass(frozen=True)
class SemanticSnapshot:
    """A whole tree for one committed render."""

    sessionId: str
    revision: int
    columns: int
    rows: int
    rootIds: Sequence[str] = field(default_factory=list)
    nodes: Sequence[SemanticNode] = field(default_factory=list)
    cursor: Optional[CursorInfo] = None
    v: int = 1

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {
            "v": self.v,
            "sessionId": self.sessionId,
            "revision": self.revision,
            "columns": self.columns,
            "rows": self.rows,
        }
        if self.cursor is not None:
            wire["cursor"] = self.cursor.to_wire()
        wire["rootIds"] = list(self.rootIds)
        wire["nodes"] = [node.to_wire() for node in self.nodes]
        return wire


def snapshot_from_wire(value: Dict[str, Any]) -> SemanticSnapshot:
    """Rebuild a snapshot from an already-validated wire object."""
    nodes: List[SemanticNode] = []
    for raw in value["nodes"]:
        bounds = raw.get("bounds")
        state = raw.get("state")
        ranges = raw.get("textRanges")
        nodes.append(
            SemanticNode(
                id=raw["id"],
                role=raw["role"],
                name=raw.get("name", ""),
                parentId=raw.get("parentId"),
                description=raw.get("description"),
                value=raw.get("value"),
                bounds=Rect(**bounds) if bounds is not None else None,
                state=SemanticState(**state) if state is not None else None,
                actions=tuple(raw["actions"]) if raw.get("actions") is not None else None,
                labelledBy=tuple(raw["labelledBy"]) if raw.get("labelledBy") is not None else None,
                describedBy=tuple(raw["describedBy"]) if raw.get("describedBy") is not None else None,
                textRanges=tuple(
                    SemanticTextRange(
                        startOffset=item["startOffset"],
                        endOffset=item["endOffset"],
                        rect=Rect(**item["rect"]),
                    )
                    for item in ranges
                )
                if ranges is not None
                else None,
                testId=raw.get("testId"),
            )
        )
    cursor = value.get("cursor")
    return SemanticSnapshot(
        sessionId=value["sessionId"],
        revision=value["revision"],
        columns=value["columns"],
        rows=value["rows"],
        rootIds=tuple(value["rootIds"]),
        nodes=tuple(nodes),
        cursor=CursorInfo(**cursor) if cursor is not None else None,
        v=value["v"],
    )
