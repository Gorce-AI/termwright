"""Semantic tree DTOs.

These mirror ``@termwright/protocol``'s ``tree.ts``. ``to_wire`` drops unset
optionals, because the wire schema is strict: an explicit ``null`` is a
validation failure, not "absent".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union


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
class EvidenceProvenance:
    """Origin and strength of an authoritative or diagnostic observation."""

    source: str
    method: str
    strength: str
    providerId: str

    def to_wire(self) -> Dict[str, str]:
        return {
            "source": self.source,
            "method": self.method,
            "strength": self.strength,
            "providerId": self.providerId,
        }


def framework_evidence(provider_id: str) -> EvidenceProvenance:
    """Build authoritative native framework provenance for a provider."""

    return EvidenceProvenance("framework", "native", "authoritative", provider_id)


@dataclass(frozen=True)
class Observation:
    """Evidence-qualified wire fact.

    ``known`` carries the value and provenance; authoritative ``absent`` also
    carries provenance proving that no value exists.
    """

    status: str
    value: Any = None
    evidence: Optional[EvidenceProvenance] = None
    reason: Optional[str] = None
    capability: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {"status": self.status}
        if self.status == "known":
            wire["value"] = self.value.to_wire() if hasattr(self.value, "to_wire") else self.value
            wire["evidence"] = self.evidence.to_wire() if self.evidence is not None else None
        elif self.status == "absent":
            wire["reason"] = self.reason
            wire["evidence"] = self.evidence.to_wire() if self.evidence is not None else None
        elif self.status == "unsupported":
            wire["capability"] = self.capability
            wire["reason"] = self.reason
        else:
            wire["reason"] = self.reason
        return wire


@dataclass(frozen=True)
class NodeGeometryObservations:
    displayed: Observation
    intendedRect: Observation
    visibleRect: Observation

    def to_wire(self) -> Dict[str, Any]:
        return {"displayed": self.displayed.to_wire(), "intendedRect": self.intendedRect.to_wire(), "visibleRect": self.visibleRect.to_wire()}


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
    #: Every cell is outside the visible area — scrolled away, not undisplayed.
    #: Implies ``hidden``; the pair without it is refused by validation.
    offscreen: Optional[bool] = None
    readonly: Optional[bool] = None
    multiline: Optional[bool] = None
    required: Optional[bool] = None
    multiselectable: Optional[bool] = None
    orientation: Optional[str] = None
    level: Optional[int] = None
    positionInSet: Optional[int] = None
    setSize: Optional[int] = None

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
class SemanticScrollState:
    """Production application viewport state, distinct from terminal scrollback."""

    axis: str
    offset: int
    viewport: int
    extent: int

    def to_wire(self) -> Dict[str, Any]:
        return {
            "axis": self.axis,
            "offset": self.offset,
            "viewport": self.viewport,
            "extent": self.extent,
        }


@dataclass(frozen=True)
class SemanticPaintedRegion:
    """Exact viewport cells painted by one semantic recipient."""

    regionBounds: Rect
    spans: Sequence[Mapping[str, int]]

    def to_wire(self) -> Dict[str, Any]:
        return {
            "regionBounds": self.regionBounds.to_wire(),
            "spans": [dict(span) for span in self.spans],
        }


@dataclass(frozen=True)
class SemanticValueObservation:
    """A semantic value with support, absence and confidentiality preserved."""

    status: str
    value: Optional[str] = None
    sensitivity: Optional[str] = None
    evidence: Optional[EvidenceProvenance] = None
    reason: Optional[str] = None
    capability: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {"status": self.status}
        if self.value is not None:
            wire["value"] = self.value
        if self.sensitivity is not None:
            wire["sensitivity"] = self.sensitivity
        if self.evidence is not None:
            wire["evidence"] = self.evidence.to_wire()
        if self.reason is not None:
            wire["reason"] = self.reason
        if self.capability is not None:
            wire["capability"] = self.capability
        return wire


@dataclass(frozen=True)
class SemanticNode:
    """One accessible node with evidence-qualified geometry."""

    id: str
    role: str
    geometry: NodeGeometryObservations
    name: str = ""
    parentId: Optional[str] = None
    description: Optional[str] = None
    value: Optional[SemanticValueObservation] = None
    state: Optional[SemanticState] = None
    #: Application-defined JSON state. Portable flags stay in ``state``.
    extended: Optional[Mapping[str, Any]] = None
    actions: Optional[Sequence[str]] = None
    inputRecipes: Optional[Sequence[Mapping[str, Any]]] = None
    labelledBy: Optional[Sequence[str]] = None
    describedBy: Optional[Sequence[str]] = None
    textRanges: Optional[Sequence[SemanticTextRange]] = None
    testId: Optional[str] = None
    #: What the UI framework calls this widget. Required when ``role`` is
    #: ``generic``: an unrecognised widget must at least name its own type, so
    #: a reader can tell one unknown thing from another.
    frameworkType: Optional[str] = None
    #: True when this node may own children the framework cannot enumerate.
    opaqueChildren: bool = False
    #: Where this node's facts came from, as a whole.
    p: Optional[str] = None
    #: Where individual fields came from, when they differ from ``p``.
    px: Optional[Mapping[str, str]] = None
    scroll: Optional[Observation] = None
    paintedRegion: Optional[Observation] = None

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {"id": self.id, "role": self.role, "name": self.name}
        if self.parentId is not None:
            wire["parentId"] = self.parentId
        if self.description is not None:
            wire["description"] = self.description
        if self.value is not None:
            wire["value"] = self.value.to_wire()
        if self.state is not None:
            state = self.state.to_wire()
            if state:
                wire["state"] = state
        if self.extended is not None:
            wire["extended"] = _canonical_extended(self.extended)
        if self.actions is not None:
            wire["actions"] = list(self.actions)
        if self.inputRecipes is not None:
            wire["inputRecipes"] = [dict(recipe) for recipe in self.inputRecipes]
        if self.labelledBy is not None:
            wire["labelledBy"] = list(self.labelledBy)
        if self.describedBy is not None:
            wire["describedBy"] = list(self.describedBy)
        if self.textRanges is not None:
            wire["textRanges"] = [item.to_wire() for item in self.textRanges]
        if self.testId is not None:
            wire["testId"] = self.testId
        if self.frameworkType is not None:
            wire["frameworkType"] = self.frameworkType
        if self.opaqueChildren:
            wire["opaqueChildren"] = True
        if self.p is not None:
            wire["p"] = self.p
        if self.px:
            wire["px"] = dict(self.px)
        wire["geometry"] = self.geometry.to_wire()
        if self.scroll is not None:
            wire["scroll"] = self.scroll.to_wire()
        if self.paintedRegion is not None:
            wire["paintedRegion"] = self.paintedRegion.to_wire()
        return wire


def _canonical_extended(value: Any) -> Any:
    """Copy JSON-like domain state with stable object-key ordering."""
    if isinstance(value, Mapping):
        return {key: _canonical_extended(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonical_extended(item) for item in value]
    return value


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
    coordinateSpace: Observation
    hitGrid: Observation
    rootIds: Sequence[str] = field(default_factory=list)
    nodes: Sequence[SemanticNode] = field(default_factory=list)
    cursor: Optional[CursorInfo] = None
    v: int = 3

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
        wire["coordinateSpace"] = self.coordinateSpace.to_wire()
        wire["hitGrid"] = self.hitGrid.to_wire()
        return wire


def snapshot_from_wire(value: Dict[str, Any]) -> SemanticSnapshot:
    """Rebuild a snapshot from an already-validated wire object."""
    def observation(raw: Mapping[str, Any], *, rect: bool = False) -> Observation:
        observed = raw.get("value")
        if rect and isinstance(observed, Mapping):
            observed = Rect(**observed)
        return Observation(
            status=raw["status"],
            value=observed,
            evidence=(EvidenceProvenance(**raw["evidence"]) if isinstance(raw.get("evidence"), dict) else None),
            reason=raw.get("reason"),
            capability=raw.get("capability"),
        )

    nodes: List[SemanticNode] = []
    for raw in value["nodes"]:
        state = raw.get("state")
        ranges = raw.get("textRanges")
        geometry = raw["geometry"]
        nodes.append(
            SemanticNode(
                id=raw["id"],
                role=raw["role"],
                name=raw.get("name", ""),
                parentId=raw.get("parentId"),
                description=raw.get("description"),
                value=(
                    SemanticValueObservation(
                        status=raw["value"]["status"],
                        value=raw["value"].get("value"),
                        sensitivity=raw["value"].get("sensitivity"),
                        evidence=(EvidenceProvenance(**raw["value"]["evidence"]) if isinstance(raw["value"].get("evidence"), dict) else None),
                        reason=raw["value"].get("reason"),
                        capability=raw["value"].get("capability"),
                    )
                    if isinstance(raw.get("value"), dict)
                    else None
                ),
                state=SemanticState(**state) if state is not None else None,
                extended=raw.get("extended"),
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
                frameworkType=raw.get("frameworkType"),
                opaqueChildren=raw.get("opaqueChildren", False),
                p=raw.get("p"),
                px=raw.get("px"),
                geometry=NodeGeometryObservations(
                    displayed=observation(geometry["displayed"]),
                    intendedRect=observation(geometry["intendedRect"], rect=True),
                    visibleRect=observation(geometry["visibleRect"], rect=True),
                ),
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
        coordinateSpace=observation(value["coordinateSpace"]),
        hitGrid=observation(value["hitGrid"]),
    )
