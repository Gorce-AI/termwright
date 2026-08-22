"""Closed vocabularies. Unknown members are rejected, never passed through."""

from __future__ import annotations

SEMANTIC_ROLES = (
    "application",
    "region",
    "dialog",
    "alert",
    "status",
    "list",
    "listitem",
    "menu",
    "menuitem",
    "button",
    "checkbox",
    "radio",
    "tab",
    "textbox",
    "heading",
    "text",
    "progressbar",
    "separator",
    "scrollbar",
    "table",
    "row",
    "cell",
    "generic",
)

SEMANTIC_ACTIONS = (
    "focus",
    "activate",
    "toggle",
    "setValue",
    "scroll",
    "select",
    "expand",
)

ADAPTER_CAPABILITIES = (
    "tree",
    "intended-geometry",
    "clipped-geometry",
    "states",
    "focus-state",
    "actions",
    "action-recipes",
    "text-ranges",
    "render-revisions",
    "logs",
    "pointer-hit-grid",
)

EVIDENCE_PROVIDER_CAPABILITIES = (
    "pointer-regions",
    "hit-test",
    "focus-state",
    "action-recipes",
    "scroll-state",
    "painted-regions",
    "terminal-input-modes",
)

ROLE_SET = frozenset(SEMANTIC_ROLES)
ACTION_SET = frozenset(SEMANTIC_ACTIONS)
CAPABILITY_SET = frozenset(ADAPTER_CAPABILITIES)
EVIDENCE_PROVIDER_CAPABILITY_SET = frozenset(EVIDENCE_PROVIDER_CAPABILITIES)
