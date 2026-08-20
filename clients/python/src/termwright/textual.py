"""Optional semantic intent for custom Textual widgets.

Textual's automatic probe already knows the DOM, geometry, focus and widget
state.  This module deliberately cannot describe any of those physical facts;
it only supplies application meaning that the framework cannot infer.

The class decorator is the normal API::

    @semantic(
        role="button",
        name=lambda widget: widget.label,
        test_id="deploy-production",
        extended=lambda widget: {"environment": widget.environment},
        key=lambda widget: f"deployment:{widget.environment}",
    )
    class DeployWidget(Widget):
        ...

``annotate`` is available for third-party widget instances that cannot be
decorated.  Both APIs are dormant metadata only: importing this module opens
no socket and does not install the Textual probe.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Callable, Mapping, Optional, Sequence, Tuple, TypeVar, Union
from weakref import WeakKeyDictionary

from .roles import ACTION_SET, SEMANTIC_ROLES

T = TypeVar("T")
ResolvedOrFactory = Union[T, Callable[[Any], T]]
Relationship = Union[Any, Sequence[Any]]

_CLASS_ANNOTATION = "__termwright_textual_semantics__"
_instances: "WeakKeyDictionary[Any, SemanticAnnotation]" = WeakKeyDictionary()


@dataclass(frozen=True)
class SemanticAnnotation:
    """Developer-owned semantic intent.

    There are intentionally no bounds, focus, visibility, rendered-text or
    portable framework-state fields.  Those are observed facts and an
    annotation must not be able to contradict them.
    """

    role: Optional[ResolvedOrFactory[str]] = None
    name: Optional[ResolvedOrFactory[str]] = None
    description: Optional[ResolvedOrFactory[str]] = None
    test_id: Optional[ResolvedOrFactory[str]] = None
    extended: Optional[ResolvedOrFactory[Mapping[str, Any]]] = None
    labelled_by: Optional[ResolvedOrFactory[Relationship]] = None
    described_by: Optional[ResolvedOrFactory[Relationship]] = None
    actions: Optional[ResolvedOrFactory[Sequence[str]]] = None
    key: Optional[ResolvedOrFactory[str]] = None


@dataclass(frozen=True)
class ResolvedAnnotation:
    """One annotation evaluated against the current widget instance."""

    role: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    test_id: Optional[str] = None
    extended: Optional[Mapping[str, Any]] = None
    labelled_by: Tuple[Any, ...] = ()
    described_by: Tuple[Any, ...] = ()
    actions: Optional[Tuple[str, ...]] = None
    key: Optional[str] = None


def semantic(
    *,
    role: Optional[ResolvedOrFactory[str]] = None,
    name: Optional[ResolvedOrFactory[str]] = None,
    description: Optional[ResolvedOrFactory[str]] = None,
    test_id: Optional[ResolvedOrFactory[str]] = None,
    extended: Optional[ResolvedOrFactory[Mapping[str, Any]]] = None,
    labelled_by: Optional[ResolvedOrFactory[Relationship]] = None,
    described_by: Optional[ResolvedOrFactory[Relationship]] = None,
    actions: Optional[ResolvedOrFactory[Sequence[str]]] = None,
    key: Optional[ResolvedOrFactory[str]] = None,
) -> Callable[[T], T]:
    """Decorate a Textual widget class with semantic intent.

    Values may be constants or callables receiving the live widget.  A
    subclass inherits the declaration naturally; another decorator on the
    subclass replaces only the fields it explicitly supplies.
    """

    annotation = _make_annotation(
        role=role,
        name=name,
        description=description,
        test_id=test_id,
        extended=extended,
        labelled_by=labelled_by,
        described_by=described_by,
        actions=actions,
        key=key,
    )

    def decorate(klass: T) -> T:
        inherited = getattr(klass, _CLASS_ANNOTATION, SemanticAnnotation())
        setattr(klass, _CLASS_ANNOTATION, _merge(inherited, annotation))
        return klass

    return decorate


def annotate(
    widget: T,
    *,
    role: Optional[ResolvedOrFactory[str]] = None,
    name: Optional[ResolvedOrFactory[str]] = None,
    description: Optional[ResolvedOrFactory[str]] = None,
    test_id: Optional[ResolvedOrFactory[str]] = None,
    extended: Optional[ResolvedOrFactory[Mapping[str, Any]]] = None,
    labelled_by: Optional[ResolvedOrFactory[Relationship]] = None,
    described_by: Optional[ResolvedOrFactory[Relationship]] = None,
    actions: Optional[ResolvedOrFactory[Sequence[str]]] = None,
    key: Optional[ResolvedOrFactory[str]] = None,
) -> T:
    """Attach semantic intent to one retained widget and return that widget."""

    current = _instances.get(widget, SemanticAnnotation())
    _instances[widget] = _merge(
        current,
        _make_annotation(
            role=role,
            name=name,
            description=description,
            test_id=test_id,
            extended=extended,
            labelled_by=labelled_by,
            described_by=described_by,
            actions=actions,
            key=key,
        ),
    )
    return widget


def remove_annotation(widget: Any) -> None:
    """Remove an instance annotation; class annotations remain in force."""

    _instances.pop(widget, None)


def resolve_annotation(widget: Any) -> ResolvedAnnotation:
    """Resolve inherited and instance declarations for the automatic probe."""

    declared = getattr(type(widget), _CLASS_ANNOTATION, SemanticAnnotation())
    instance = _instances.get(widget)
    annotation = _merge(declared, instance) if instance is not None else declared

    role = _optional_string(_resolve(annotation.role, widget), "role")
    if role is not None and role not in SEMANTIC_ROLES:
        raise ValueError(f"unknown semantic role: {role!r}")

    extended_value = _resolve(annotation.extended, widget)
    if extended_value is not None and not isinstance(extended_value, Mapping):
        raise TypeError("extended must resolve to a mapping")
    extended = dict(extended_value) if extended_value is not None else None

    action_value = _resolve(annotation.actions, widget)
    actions = _semantic_actions(action_value)

    return ResolvedAnnotation(
        role=role,
        name=_optional_string(_resolve(annotation.name, widget), "name", allow_empty=True),
        description=_optional_string(
            _resolve(annotation.description, widget), "description", allow_empty=True
        ),
        test_id=_optional_string(_resolve(annotation.test_id, widget), "test_id"),
        extended=extended,
        labelled_by=_relationships(_resolve(annotation.labelled_by, widget)),
        described_by=_relationships(_resolve(annotation.described_by, widget)),
        actions=actions,
        key=_optional_string(_resolve(annotation.key, widget), "key"),
    )


def _make_annotation(**values: Any) -> SemanticAnnotation:
    role = values.get("role")
    if isinstance(role, str) and role not in SEMANTIC_ROLES:
        raise ValueError(f"unknown semantic role: {role!r}")
    actions = values.get("actions")
    if actions is not None and not callable(actions):
        _semantic_actions(actions)
    return SemanticAnnotation(**values)


def _semantic_actions(value: Any) -> Optional[Tuple[str, ...]]:
    if value is None:
        return None
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise TypeError("actions must resolve to a sequence of semantic actions")
    actions = tuple(value)
    if any(not isinstance(action, str) or action not in ACTION_SET for action in actions):
        raise ValueError("actions must contain only v1 semantic actions")
    if len(set(actions)) != len(actions):
        raise ValueError("actions must not contain duplicates")
    return actions


def _merge(base: SemanticAnnotation, override: Optional[SemanticAnnotation]) -> SemanticAnnotation:
    if override is None:
        return base
    values = {
        field: getattr(override, field)
        if getattr(override, field) is not None
        else getattr(base, field)
        for field in SemanticAnnotation.__dataclass_fields__
    }
    return replace(base, **values)


def _resolve(value: Optional[ResolvedOrFactory[T]], widget: Any) -> Optional[T]:
    return value(widget) if callable(value) else value


def _optional_string(value: Any, field: str, *, allow_empty: bool = False) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str) or (not allow_empty and not value):
        qualifier = "a string" if allow_empty else "a non-empty string"
        raise TypeError(f"{field} must resolve to {qualifier}")
    return value


def _relationships(value: Any) -> Tuple[Any, ...]:
    if value is None:
        return ()
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return tuple(value)
    return (value,)


__all__ = [
    "ResolvedAnnotation",
    "SemanticAnnotation",
    "annotate",
    "remove_annotation",
    "semantic",
]
