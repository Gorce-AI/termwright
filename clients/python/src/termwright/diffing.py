"""Turning two consecutive trees into the delta between them.

The driver asks for `subscribe: 'diffs'` when it wants patches instead of whole
trees. Producing one is the mirror of composing one, and it has to agree with
:func:`termwright.validate.apply_tree_delta` exactly: whatever this emits, the
driver will apply, and any disagreement shows up as a tree that silently drifts
from the screen.

Two rules here are easy to get wrong and both are load-bearing:

* A node that *survives* under a parent being removed must be re-sent in
  ``changed``, even when nothing about it changed, because the removal cascades
  through it first.
* ``rootIds`` must be sent whenever the inherited list — the base's roots minus
  whatever the removals took — is not the list the new tree wants.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

#: Beyond this share of the tree, a delta stops paying for itself and the whole
#: snapshot is cheaper to send and cheaper to reason about.
DELTA_SHARE_CEILING = 0.5


def _canonical(node: Mapping[str, Any]) -> str:
    """Stable text for a node, so two nodes compare by value."""
    return json.dumps(node, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def diff_trees(
    base: Mapping[str, Any], next_tree: Mapping[str, Any]
) -> Tuple[List[Dict[str, Any]], List[str], Optional[List[str]], bool]:
    """Compute ``(changed, removed, root_ids, cursor_changed)``.

    ``root_ids`` is ``None`` when the inherited list already matches, which
    keeps the delta smaller by the most common amount.
    """
    base_nodes: Dict[str, Any] = {node["id"]: node for node in base["nodes"]}
    next_nodes: Dict[str, Any] = {node["id"]: node for node in next_tree["nodes"]}

    children_of: Dict[str, List[str]] = {}
    for node in base["nodes"]:
        parent = node.get("parentId")
        if parent is not None:
            children_of.setdefault(parent, []).append(node["id"])

    gone = {node_id for node_id in base_nodes if node_id not in next_nodes}

    # Only the topmost id of each removed subtree needs sending: the cascade
    # takes the rest, which is what makes a delta small.
    removal_roots: List[str] = []
    for node_id in gone:
        parent = base_nodes[node_id].get("parentId")
        if parent is None or parent not in gone:
            removal_roots.append(node_id)

    # Everything the cascade will take, so survivors underneath can be re-sent.
    swept: Set[str] = set()
    pending = list(removal_roots)
    while pending:
        current = pending.pop()
        if current in swept:
            continue
        swept.add(current)
        pending.extend(children_of.get(current, ()))

    changed: List[Dict[str, Any]] = []
    for node_id, node in next_nodes.items():
        previous = base_nodes.get(node_id)
        if previous is None or _canonical(previous) != _canonical(node) or node_id in swept:
            changed.append(dict(node))

    survivors = (set(base_nodes) - swept) | set(next_nodes)
    inherited = [node_id for node_id in base["rootIds"] if node_id in survivors]
    root_ids = None if inherited == list(next_tree["rootIds"]) else list(next_tree["rootIds"])

    cursor_changed = base.get("cursor") != next_tree.get("cursor")
    return changed, sorted(removal_roots), root_ids, cursor_changed


def build_delta(
    base: Mapping[str, Any], next_tree: Mapping[str, Any]
) -> Optional[Dict[str, Any]]:
    """Build the `tree-delta` body, or ``None`` when a full tree is cheaper.

    Returning ``None`` is not a failure: past roughly half the tree a delta
    costs more to send and far more to reason about than the snapshot it
    replaces.
    """
    changed, removed, root_ids, cursor_changed = diff_trees(base, next_tree)

    node_count = max(1, len(next_tree["nodes"]))
    if len(changed) > node_count * DELTA_SHARE_CEILING:
        return None

    if base.get("cursor") is not None and next_tree.get("cursor") is None:
        # A delta can replace a cursor but never remove one, and an absent
        # cursor is inherited — so the only honest way to drop it is a whole
        # tree. Sending the delta anyway would leave the driver holding a
        # cursor the application no longer reports.
        return None

    delta: Dict[str, Any] = {
        "type": "tree-delta",
        "baseRevision": base["revision"],
        "revision": next_tree["revision"],
        "changed": changed,
        "removed": removed,
    }
    if root_ids is not None:
        delta["rootIds"] = root_ids
    # An absent cursor means unchanged, so it is sent only when it moved.
    if cursor_changed and next_tree.get("cursor") is not None:
        delta["cursor"] = next_tree["cursor"]
    return delta
