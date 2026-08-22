"""Typed, revision-bound application evidence providers.

Providers expose production facts only.  They never receive a dispatch
callback; Termwright later executes their data-only recipes through the real
PTY keyboard device.
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple


@dataclass(frozen=True)
class EvidenceRevisionContext:
    """Exact session/revision requested from an application provider."""

    sessionId: str
    revision: int
    columns: int
    rows: int


@dataclass(frozen=True)
class ApplicationActionStrategyProvider:
    """Application production keybindings for semantic recipients."""

    id: str
    version: str
    method: str
    observe: Callable[[EvidenceRevisionContext], Sequence[Mapping[str, Any]]]


@dataclass(frozen=True)
class ApplicationFocusEvidenceProvider:
    """Application production focus manager for one committed revision."""

    id: str
    version: str
    method: str
    observe: Callable[[EvidenceRevisionContext], Optional[Mapping[str, Any]]]


@dataclass(frozen=True)
class ApplicationScrollEvidenceProvider:
    """Application production viewport model for semantic recipients."""

    id: str
    version: str
    method: str
    observe: Callable[[EvidenceRevisionContext], Sequence[Mapping[str, Any]]]


@dataclass(frozen=True)
class ApplicationPaintEvidenceProvider:
    """Application production painter attribution for semantic recipients."""

    id: str
    version: str
    method: str
    observe: Callable[[EvidenceRevisionContext], Sequence[Mapping[str, Any]]]


@dataclass(frozen=True)
class ApplicationTerminalInputModeEvidenceProvider:
    """Application production terminal parser configuration."""

    id: str
    version: str
    method: str
    observe: Callable[[EvidenceRevisionContext], Mapping[str, Any]]


class EvidenceProviderLifecycleError(RuntimeError):
    """Registration violated the before-freeze provider lifecycle."""


class EvidenceProviderRegistration:
    def __init__(self, registry: "EvidenceProviderRegistry", provider_id: str) -> None:
        self._registry = registry
        self._provider_id = provider_id
        self._closed = False

    def close(self) -> None:
        """Remove before freeze, or publish provider loss after freeze."""
        if self._closed:
            return
        self._closed = True
        self._registry._dispose(self._provider_id)


class _Entry:
    def __init__(self, provider: Any, family: str) -> None:
        self.provider = provider
        self.family = family
        self.active = True


class FrozenEvidenceProviderRegistry:
    def __init__(self, registry: "EvidenceProviderRegistry", entries: Sequence[_Entry]) -> None:
        self._registry = registry
        self._entries = tuple(entries)
        self._closed = False

    @property
    def registrations(self) -> Sequence[Mapping[str, Any]]:
        return tuple(
            {
                "id": entry.provider.id,
                "version": entry.provider.version,
                "method": entry.provider.method,
                "capabilities": [
                    "action-recipes"
                    if entry.family == "action-strategy"
                    else "focus-state"
                    if entry.family == "focus"
                    else "scroll-state"
                    if entry.family == "scroll"
                    else "painted-regions"
                    if entry.family == "paint"
                    else "terminal-input-modes"
                ],
            }
            for entry in self._entries
        )

    def collect(
        self,
        context: EvidenceRevisionContext,
        resolve_recipient: Callable[[Mapping[str, Any]], str],
    ) -> Sequence[Mapping[str, Any]]:
        frames: List[Mapping[str, Any]] = []
        for entry in self._entries:
            provider = entry.provider
            base: Dict[str, Any] = {
                "providerId": provider.id,
                "sessionId": context.sessionId,
                "revision": context.revision,
            }
            if not entry.active:
                frames.append({
                    **base,
                    "status": "lost",
                    "reason": "provider was disposed after negotiation",
                })
                continue
            try:
                observed = provider.observe(context)
                frame: Dict[str, Any] = {
                    **base,
                    "status": "available",
                    "evidence": {
                        "source": "application",
                        "method": provider.method,
                        "strength": "authoritative",
                        "providerId": provider.id,
                    },
                    "pointerRegions": [],
                }
                if entry.family == "focus":
                    frame["focusState"] = (
                        {"status": "none"}
                        if observed is None
                        else {
                            "status": "focused",
                            "recipientId": resolve_recipient(observed),
                        }
                    )
                elif entry.family == "action-strategy":
                    action_recipes = []
                    for raw in observed:
                        recipient = raw.get("recipient")
                        recipes = raw.get("recipes")
                        if not isinstance(recipient, Mapping) or not isinstance(recipes, Sequence):
                            raise TypeError("action recipe evidence requires recipient and recipes")
                        action_recipes.append({
                            "recipientId": resolve_recipient(recipient),
                            "recipes": [dict(recipe) for recipe in recipes],
                        })
                    frame["actionRecipes"] = action_recipes
                elif entry.family == "scroll":
                    scroll_states = []
                    for raw in observed:
                        recipient = raw.get("recipient")
                        if not isinstance(recipient, Mapping):
                            raise TypeError("scroll evidence requires a recipient")
                        axis = raw.get("axis")
                        offset = raw.get("offset")
                        viewport = raw.get("viewport")
                        extent = raw.get("extent")
                        if axis not in ("vertical", "horizontal") or any(
                            not isinstance(value, int) or isinstance(value, bool) or value < 0
                            for value in (offset, viewport, extent)
                        ) or offset + viewport > extent:
                            raise TypeError("scroll state must fit inside its extent")
                        scroll_states.append({
                            "recipientId": resolve_recipient(recipient),
                            "axis": axis,
                            "offset": offset,
                            "viewport": viewport,
                            "extent": extent,
                        })
                    frame["scrollStates"] = scroll_states
                elif entry.family == "paint":
                    painted_regions = []
                    for raw in observed:
                        recipient = raw.get("recipient")
                        bounds = raw.get("regionBounds")
                        spans = raw.get("spans")
                        if not isinstance(recipient, Mapping) or not isinstance(bounds, Mapping) or not isinstance(spans, Sequence):
                            raise TypeError("paint evidence requires recipient, regionBounds and spans")
                        painted_regions.append({
                            "recipientId": resolve_recipient(recipient),
                            "regionBounds": dict(bounds),
                            "spans": [dict(span) for span in spans],
                        })
                    frame["paintedRegions"] = painted_regions
                else:
                    if not isinstance(observed, Mapping):
                        raise TypeError("input mode evidence must be a mapping")
                    mouse_tracking = observed.get("mouseTracking")
                    mouse_encoding = observed.get("mouseEncoding")
                    focus_reporting = observed.get("focusReporting")
                    if mouse_tracking not in ("none", "x10", "vt200", "drag", "any"):
                        raise TypeError("input modes contain an invalid mouseTracking value")
                    if mouse_encoding not in ("default", "sgr", "urxvt", "utf8"):
                        raise TypeError("input modes contain an invalid mouseEncoding value")
                    if focus_reporting not in ("on", "off"):
                        raise TypeError("input modes contain an invalid focusReporting value")
                    frame["inputModes"] = {
                        "mouseTracking": mouse_tracking,
                        "mouseEncoding": mouse_encoding,
                        "focusReporting": focus_reporting,
                    }
                frames.append(frame)
            except Exception as error:  # provider defects are protocol evidence, not app crashes
                frames.append({**base, "status": "violation", "reason": str(error)})
        return tuple(frames)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._registry._release()


class EvidenceProviderRegistry:
    """Application-scoped registry with a deterministic contract freeze."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._active_leases = 0
        self._entries: Dict[str, _Entry] = {}

    def register_action_strategies(
        self, provider: ApplicationActionStrategyProvider
    ) -> EvidenceProviderRegistration:
        with self._lock:
            if self._active_leases:
                raise EvidenceProviderLifecycleError(
                    f"provider {provider.id or '<empty>'} registered after contract freeze"
                )
            if not 1 <= len(provider.id) <= 128 or not 1 <= len(provider.version) <= 128:
                raise TypeError("provider id and version must contain 1..128 characters")
            if provider.method not in ("native", "declared"):
                raise TypeError("provider method must be native or declared")
            if provider.id in self._entries:
                raise EvidenceProviderLifecycleError(f"provider {provider.id} is already registered")
            self._entries[provider.id] = _Entry(provider, "action-strategy")
        return EvidenceProviderRegistration(self, provider.id)

    def register_focus(
        self, provider: ApplicationFocusEvidenceProvider
    ) -> EvidenceProviderRegistration:
        with self._lock:
            if self._active_leases:
                raise EvidenceProviderLifecycleError(
                    f"provider {provider.id or '<empty>'} registered after contract freeze"
                )
            if not 1 <= len(provider.id) <= 128 or not 1 <= len(provider.version) <= 128:
                raise TypeError("provider id and version must contain 1..128 characters")
            if provider.method not in ("native", "declared"):
                raise TypeError("provider method must be native or declared")
            if provider.id in self._entries:
                raise EvidenceProviderLifecycleError(f"provider {provider.id} is already registered")
            self._entries[provider.id] = _Entry(provider, "focus")
        return EvidenceProviderRegistration(self, provider.id)

    def register_scroll(
        self, provider: ApplicationScrollEvidenceProvider
    ) -> EvidenceProviderRegistration:
        with self._lock:
            if self._active_leases:
                raise EvidenceProviderLifecycleError(
                    f"provider {provider.id or '<empty>'} registered after contract freeze"
                )
            if not 1 <= len(provider.id) <= 128 or not 1 <= len(provider.version) <= 128:
                raise TypeError("provider id and version must contain 1..128 characters")
            if provider.method not in ("native", "declared"):
                raise TypeError("provider method must be native or declared")
            if provider.id in self._entries:
                raise EvidenceProviderLifecycleError(f"provider {provider.id} is already registered")
            self._entries[provider.id] = _Entry(provider, "scroll")
        return EvidenceProviderRegistration(self, provider.id)

    def register_paint(
        self, provider: ApplicationPaintEvidenceProvider
    ) -> EvidenceProviderRegistration:
        with self._lock:
            if self._active_leases:
                raise EvidenceProviderLifecycleError(
                    f"provider {provider.id or '<empty>'} registered after contract freeze"
                )
            if not 1 <= len(provider.id) <= 128 or not 1 <= len(provider.version) <= 128:
                raise TypeError("provider id and version must contain 1..128 characters")
            if provider.method not in ("native", "declared"):
                raise TypeError("provider method must be native or declared")
            if provider.id in self._entries:
                raise EvidenceProviderLifecycleError(f"provider {provider.id} is already registered")
            self._entries[provider.id] = _Entry(provider, "paint")
        return EvidenceProviderRegistration(self, provider.id)

    def register_input_modes(
        self, provider: ApplicationTerminalInputModeEvidenceProvider
    ) -> EvidenceProviderRegistration:
        with self._lock:
            if self._active_leases:
                raise EvidenceProviderLifecycleError(
                    f"provider {provider.id or '<empty>'} registered after contract freeze"
                )
            if not 1 <= len(provider.id) <= 128 or not 1 <= len(provider.version) <= 128:
                raise TypeError("provider id and version must contain 1..128 characters")
            if provider.method not in ("native", "declared"):
                raise TypeError("provider method must be native or declared")
            if provider.id in self._entries:
                raise EvidenceProviderLifecycleError(f"provider {provider.id} is already registered")
            self._entries[provider.id] = _Entry(provider, "input-mode")
        return EvidenceProviderRegistration(self, provider.id)

    def freeze(self) -> FrozenEvidenceProviderRegistry:
        with self._lock:
            self._active_leases += 1
            entries = tuple(self._entries.values())
        return FrozenEvidenceProviderRegistry(self, entries)

    def _dispose(self, provider_id: str) -> None:
        with self._lock:
            entry = self._entries.pop(provider_id, None)
            if entry is not None:
                entry.active = False

    def _release(self) -> None:
        with self._lock:
            self._active_leases -= 1


_default_registry = EvidenceProviderRegistry()


def default_evidence_provider_registry() -> EvidenceProviderRegistry:
    """Registry consumed by zero-config Python framework probes."""
    return _default_registry


def register_action_strategy_provider(
    provider: ApplicationActionStrategyProvider,
    registry: Optional[EvidenceProviderRegistry] = None,
) -> EvidenceProviderRegistration:
    """Register production keybindings before the first semantic session."""
    return (registry or _default_registry).register_action_strategies(provider)


def register_focus_evidence_provider(
    provider: ApplicationFocusEvidenceProvider,
    registry: Optional[EvidenceProviderRegistry] = None,
) -> EvidenceProviderRegistration:
    """Register the production focus manager before contract freeze."""
    return (registry or _default_registry).register_focus(provider)


def register_scroll_evidence_provider(
    provider: ApplicationScrollEvidenceProvider,
    registry: Optional[EvidenceProviderRegistry] = None,
) -> EvidenceProviderRegistration:
    """Register production application viewport evidence before contract freeze."""
    return (registry or _default_registry).register_scroll(provider)


def register_paint_evidence_provider(
    provider: ApplicationPaintEvidenceProvider,
    registry: Optional[EvidenceProviderRegistry] = None,
) -> EvidenceProviderRegistration:
    """Register production paint attribution before contract freeze."""
    return (registry or _default_registry).register_paint(provider)


def register_terminal_input_mode_evidence_provider(
    provider: ApplicationTerminalInputModeEvidenceProvider,
    registry: Optional[EvidenceProviderRegistry] = None,
) -> EvidenceProviderRegistration:
    """Register production terminal parser modes before contract freeze."""
    return (registry or _default_registry).register_input_modes(provider)
