"""Running code the moment a module the application imports arrives.

The probe is installed during interpreter startup, long before the application
has imported its framework. Importing Textual ourselves at that point would be
wrong twice over: it would pay the framework's import cost in processes that
never use it, and it would fix the import order in a way the application did
not choose.

So the probe waits. A finder on `sys.meta_path` wraps the loader of the module
it is watching for and fires a callback the moment that module finishes
executing — which is the first instant its classes exist and can be patched.

Wrapping the loader rather than reacting to `find_spec` is the whole design.
`find_spec` runs *before* the module body, so nothing is there to patch yet,
and deferring to "the next import that comes past" would leave the callback
unfired whenever the watched module is the last one imported.
"""

from __future__ import annotations

import sys
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from types import ModuleType
from typing import Callable, Dict, List, Optional

Callback = Callable[[ModuleType], None]


class _NotifyingLoader(Loader):
    """Delegates to the real loader, then fires the callbacks."""

    def __init__(self, inner: Loader, fire: Callable[[ModuleType], None]) -> None:
        self._inner = inner
        self._fire = fire

    def create_module(self, spec: ModuleSpec) -> Optional[ModuleType]:
        creator = getattr(self._inner, "create_module", None)
        return None if creator is None else creator(spec)

    def exec_module(self, module: ModuleType) -> None:
        executor = getattr(self._inner, "exec_module", None)
        if executor is not None:
            executor(module)
        self._fire(module)

    def __getattr__(self, name: str) -> object:
        # Loaders carry more than the two methods above — `get_source` and
        # friends — and anything we do not override belongs to the real one.
        return getattr(self._inner, name)


class _Waiter(MetaPathFinder):
    """Watches for named modules and notifies once each has executed."""

    def __init__(self) -> None:
        self._waiting: Dict[str, List[Callback]] = {}

    def watch(self, name: str, callback: Callback) -> None:
        module = sys.modules.get(name)
        if module is not None:
            # Already imported: the application got there first, which is the
            # normal case when the probe is installed by hand rather than at
            # interpreter startup.
            callback(module)
            return
        self._waiting.setdefault(name, []).append(callback)

    def find_spec(
        self,
        fullname: str,
        path: object = None,
        target: object = None,
    ) -> Optional[ModuleSpec]:
        if fullname not in self._waiting:
            return None
        spec = self._delegate(fullname, path, target)
        if spec is None or spec.loader is None:
            return None
        spec.loader = _NotifyingLoader(spec.loader, lambda module: self._fire(fullname, module))
        return spec

    def _delegate(self, fullname: str, path: object, target: object) -> Optional[ModuleSpec]:
        """Ask the rest of the meta path who would really load this module."""
        for finder in list(sys.meta_path):
            if finder is self:
                continue
            find = getattr(finder, "find_spec", None)
            if find is None:
                continue
            try:
                spec = find(fullname, path, target)
            except Exception:
                # A finder that raises is not ours to fix, and must not turn
                # an ordinary import into a failure because we were watching.
                continue
            if spec is not None:
                return spec
        return None

    def _fire(self, fullname: str, module: ModuleType) -> None:
        for callback in self._waiting.pop(fullname, []):
            try:
                callback(module)
            except Exception:
                # A probe that cannot attach leaves the application running.
                pass


_FINDER: Optional[_Waiter] = None


def when_imported(name: str, callback: Callback) -> None:
    """Call `callback(module)` once `name` has finished importing.

    Fires immediately when the module is already in `sys.modules`.
    """
    global _FINDER
    if _FINDER is None:
        _FINDER = _Waiter()
        sys.meta_path.insert(0, _FINDER)
    _FINDER.watch(name, callback)


def reset() -> None:
    """Remove the finder. For tests; the probe never uninstalls itself."""
    global _FINDER
    if _FINDER is not None and _FINDER in sys.meta_path:
        sys.meta_path.remove(_FINDER)
    _FINDER = None
