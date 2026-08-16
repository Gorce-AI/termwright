package protocol

import "sort"

// DeltaShareCeiling is the point past which a delta stops paying for itself:
// beyond roughly half the tree, the whole snapshot is cheaper to send and far
// cheaper to reason about.
const DeltaShareCeiling = 0.5

// BuildDelta turns two consecutive trees into the delta between them, or
// returns nil when a whole snapshot is the better answer.
//
// Producing a delta is the mirror of composing one, and it has to agree with
// ApplyTreeDelta exactly: whatever this emits, the driver applies, and any
// disagreement shows up as a tree that silently drifts from the screen.
//
// Two rules here are easy to get wrong and both are load-bearing:
//
//   - a node that SURVIVES under a parent being removed must be re-sent in
//     `changed`, even when nothing about it changed, because the removal
//     cascades through it first;
//   - `rootIds` must be sent whenever the inherited list — the base's roots
//     minus whatever the removals took — is not the list the new tree wants.
func BuildDelta(base, next map[string]any) map[string]any {
	changed, removed, rootIDs, cursorChanged := DiffTrees(base, next)

	nextNodes, _ := next["nodes"].([]any)
	count := len(nextNodes)
	if count == 0 {
		count = 1
	}
	if float64(len(changed)) > float64(count)*DeltaShareCeiling {
		return nil
	}

	_, baseHasCursor := base["cursor"]
	_, nextHasCursor := next["cursor"]
	if baseHasCursor && !nextHasCursor {
		// A delta can replace a cursor but never remove one, and an absent
		// cursor is inherited — so the only honest way to drop it is a whole
		// tree. Sending the delta anyway would leave the driver holding a
		// cursor the application no longer reports.
		return nil
	}

	delta := map[string]any{
		"type":         "tree-delta",
		"baseRevision": base["revision"],
		"revision":     next["revision"],
		"changed":      changed,
		"removed":      removed,
	}
	if rootIDs != nil {
		delta["rootIds"] = rootIDs
	}
	// An absent cursor means unchanged, so it travels only when it moved.
	if cursorChanged && nextHasCursor {
		delta["cursor"] = next["cursor"]
	}
	return delta
}

// DiffTrees reports what changed, what was removed, the root list when it can
// no longer be inherited, and whether the cursor moved.
func DiffTrees(base, next map[string]any) (changed []any, removed []any, rootIDs []any, cursorChanged bool) {
	baseNodes, _ := base["nodes"].([]any)
	nextNodes, _ := next["nodes"].([]any)

	baseByID := make(map[string]map[string]any, len(baseNodes))
	childrenOf := make(map[string][]string)
	for _, raw := range baseNodes {
		node, _ := raw.(map[string]any)
		id := stringOr(node["id"])
		baseByID[id] = node
		if parent, ok := node["parentId"].(string); ok {
			childrenOf[parent] = append(childrenOf[parent], id)
		}
	}
	nextByID := make(map[string]map[string]any, len(nextNodes))
	for _, raw := range nextNodes {
		node, _ := raw.(map[string]any)
		nextByID[stringOr(node["id"])] = node
	}

	gone := make(map[string]struct{})
	for id := range baseByID {
		if _, survives := nextByID[id]; !survives {
			gone[id] = struct{}{}
		}
	}

	// Only the topmost id of each removed subtree needs sending: the cascade
	// takes the rest, which is what makes a delta small.
	removalRoots := make([]string, 0, len(gone))
	for id := range gone {
		parent, hasParent := baseByID[id]["parentId"].(string)
		if !hasParent {
			removalRoots = append(removalRoots, id)
			continue
		}
		if _, parentGone := gone[parent]; !parentGone {
			removalRoots = append(removalRoots, id)
		}
	}
	sort.Strings(removalRoots)

	// Everything the cascade will take, so survivors underneath can be re-sent.
	swept := make(map[string]struct{})
	pending := append([]string{}, removalRoots...)
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if _, seen := swept[current]; seen {
			continue
		}
		swept[current] = struct{}{}
		pending = append(pending, childrenOf[current]...)
	}

	// Walk `next` in its own order so the delta is deterministic.
	for _, raw := range nextNodes {
		node, _ := raw.(map[string]any)
		id := stringOr(node["id"])
		previous, existed := baseByID[id]
		_, sweptAway := swept[id]
		if !existed || sweptAway || !sameNode(previous, node) {
			changed = append(changed, node)
		}
	}
	if changed == nil {
		changed = []any{}
	}

	removed = make([]any, 0, len(removalRoots))
	for _, id := range removalRoots {
		removed = append(removed, id)
	}

	survivors := make(map[string]struct{}, len(nextByID))
	for id := range baseByID {
		if _, sweptAway := swept[id]; !sweptAway {
			survivors[id] = struct{}{}
		}
	}
	for id := range nextByID {
		survivors[id] = struct{}{}
	}
	baseRoots, _ := base["rootIds"].([]any)
	inherited := make([]string, 0, len(baseRoots))
	for _, raw := range baseRoots {
		id := stringOr(raw)
		if _, survives := survivors[id]; survives {
			inherited = append(inherited, id)
		}
	}
	nextRoots, _ := next["rootIds"].([]any)
	wanted := make([]string, 0, len(nextRoots))
	for _, raw := range nextRoots {
		wanted = append(wanted, stringOr(raw))
	}
	if !sameStrings(inherited, wanted) {
		rootIDs = nextRoots
		if rootIDs == nil {
			rootIDs = []any{}
		}
	}

	cursorChanged = !sameNode(mapOf(base["cursor"]), mapOf(next["cursor"]))
	return changed, removed, rootIDs, cursorChanged
}

func mapOf(value any) map[string]any {
	out, _ := value.(map[string]any)
	return out
}

// sameNode compares two wire values by their canonical encoding.
func sameNode(left, right map[string]any) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	leftBody, leftErr := marshalCanonical(sortedValue(left))
	rightBody, rightErr := marshalCanonical(sortedValue(right))
	if leftErr != nil || rightErr != nil {
		return false
	}
	return string(leftBody) == string(rightBody)
}

// sortedValue is a no-op for maps, whose Go encoding already sorts keys.
func sortedValue(value map[string]any) map[string]any { return value }

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
