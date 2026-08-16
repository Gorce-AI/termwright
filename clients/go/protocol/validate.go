package protocol

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

// ValidationError reports why a snapshot was refused. Code is the shared
// taxonomy: schema, unknown-role, duplicate-id, missing-parent, cycle, depth,
// count, string-bytes, bad-rect, revision, bytes.
type ValidationError struct {
	Code   string
	Detail string
}

func (e *ValidationError) Error() string { return e.Code + ": " + e.Detail }

// ValidationCode returns the code of a *ValidationError, or "" otherwise.
func ValidationCode(err error) string {
	if e, ok := err.(*ValidationError); ok {
		return e.Code
	}
	return ""
}

func invalid(code, format string, args ...any) *ValidationError {
	return &ValidationError{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// issue is a schema-level defect carrying the path the reference
// implementation would have reported, which is what decides its code.
type issue struct {
	path    []string
	message string
	tooBig  bool
}

func (i *issue) code() string {
	if contains(i.path, "role") {
		return "unknown-role"
	}
	if contains(i.path, "revision") {
		return "revision"
	}
	if contains(i.path, "bounds") || contains(i.path, "rect") {
		return "bad-rect"
	}
	if i.tooBig && (contains(i.path, "nodes") || contains(i.path, "rootIds")) {
		return "count"
	}
	if strings.Contains(i.message, "UTF-8 bytes") {
		return "string-bytes"
	}
	return "schema"
}

func (i *issue) toError() *ValidationError {
	where := "<root>"
	if len(i.path) > 0 {
		where = strings.Join(i.path, ".")
	}
	return &ValidationError{Code: i.code(), Detail: where + ": " + i.message}
}

func contains(path []string, key string) bool {
	for _, element := range path {
		if element == key {
			return true
		}
	}
	return false
}

func at(path []string, more ...string) []string {
	next := make([]string, 0, len(path)+len(more))
	next = append(next, path...)
	return append(next, more...)
}

func fail(path []string, message string) *issue {
	return &issue{path: path, message: message}
}

func failBig(path []string, message string) *issue {
	return &issue{path: path, message: message, tooBig: true}
}

// -- scalar checks ---------------------------------------------------------

func checkObject(value any, path []string) (map[string]any, *issue) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fail(path, "expected an object")
	}
	return object, nil
}

func checkStrict(object map[string]any, allowed []string, path []string) *issue {
	var unknown []string
	for key := range object {
		found := false
		for _, name := range allowed {
			if key == name {
				found = true
				break
			}
		}
		if !found {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	sort.Strings(unknown)
	return fail(path, "Unrecognized key(s) in object: "+strings.Join(unknown, ", "))
}

func checkNumber(value any, path []string, message string, ok func(float64) bool) (float64, *issue) {
	number, isNumber := value.(float64)
	if !isNumber || number != math.Trunc(number) || math.Abs(number) > maxSafeInteger || !ok(number) {
		return 0, fail(path, message)
	}
	return number, nil
}

func checkSafeInt(value any, path []string) (float64, *issue) {
	return checkNumber(value, path, "expected a safe integer", func(float64) bool { return true })
}

func checkNonNegative(value any, path []string) (float64, *issue) {
	return checkNumber(value, path, "expected a non-negative safe integer", func(n float64) bool { return n >= 0 })
}

func checkPositive(value any, path []string) (float64, *issue) {
	return checkNumber(value, path, "expected a positive safe integer", func(n float64) bool { return n > 0 })
}

func checkText(value any, path []string, limits Limits) (string, *issue) {
	text, ok := value.(string)
	if !ok {
		return "", fail(path, "expected a string")
	}
	if len(text) > limits.MaxStringBytes {
		return "", fail(path, fmt.Sprintf("expected at most %d UTF-8 bytes", limits.MaxStringBytes))
	}
	return text, nil
}

func checkBool(value any, path []string) (bool, *issue) {
	flag, ok := value.(bool)
	if !ok {
		return false, fail(path, "expected a boolean")
	}
	return flag, nil
}

// -- schema layer ----------------------------------------------------------

var rectKeys = []string{"row", "column", "width", "height"}

func checkRect(value any, path []string) (map[string]float64, *issue) {
	object, problem := checkObject(value, path)
	if problem != nil {
		return nil, problem
	}
	if problem := checkStrict(object, rectKeys, path); problem != nil {
		return nil, problem
	}
	rect := make(map[string]float64, 4)
	for _, key := range []string{"row", "column"} {
		number, problem := checkSafeInt(object[key], at(path, key))
		if problem != nil {
			return nil, problem
		}
		rect[key] = number
	}
	for _, key := range []string{"width", "height"} {
		number, problem := checkNonNegative(object[key], at(path, key))
		if problem != nil {
			return nil, problem
		}
		rect[key] = number
	}
	return rect, nil
}

var stateBoolKeys = []string{
	"disabled", "focused", "selected", "expanded", "modal",
	"busy", "hidden", "readonly", "multiline",
}

var stateKeys = append(append([]string{}, stateBoolKeys...),
	"checked", "orientation", "level", "positionInSet", "setSize", "scrollOffset", "scrollExtent")

func checkState(value any, path []string) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(object, stateKeys, path); problem != nil {
		return problem
	}
	for _, key := range stateBoolKeys {
		if present, ok := object[key]; ok {
			if _, problem := checkBool(present, at(path, key)); problem != nil {
				return problem
			}
		}
	}
	if checked, ok := object["checked"]; ok {
		_, isBool := checked.(bool)
		if !isBool && checked != "mixed" {
			return fail(at(path, "checked"), "expected a boolean or 'mixed'")
		}
	}
	if orientation, ok := object["orientation"]; ok {
		if orientation != "horizontal" && orientation != "vertical" {
			return fail(at(path, "orientation"), "expected 'horizontal' or 'vertical'")
		}
	}
	for _, key := range []string{"level", "positionInSet"} {
		if present, ok := object[key]; ok {
			if _, problem := checkPositive(present, at(path, key)); problem != nil {
				return problem
			}
		}
	}
	for _, key := range []string{"setSize", "scrollOffset", "scrollExtent"} {
		if present, ok := object[key]; ok {
			if _, problem := checkNonNegative(present, at(path, key)); problem != nil {
				return problem
			}
		}
	}
	return nil
}

var nodeKeys = []string{
	"id", "parentId", "role", "name", "description", "value", "bounds",
	"state", "actions", "labelledBy", "describedBy", "textRanges", "testId",
}

func checkRelations(value any, path []string, limits Limits) *issue {
	items, ok := value.([]any)
	if !ok {
		return fail(path, "expected an array")
	}
	if len(items) > limits.MaxRelationTargets {
		return failBig(path, fmt.Sprintf("expected at most %d items", limits.MaxRelationTargets))
	}
	for index, item := range items {
		if _, problem := checkText(item, at(path, fmt.Sprint(index)), limits); problem != nil {
			return problem
		}
	}
	return nil
}

func checkNodeSchema(value any, path []string, limits Limits) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(object, nodeKeys, path); problem != nil {
		return problem
	}

	id, problem := checkText(object["id"], at(path, "id"), limits)
	if problem != nil {
		return problem
	}
	if id == "" {
		return fail(at(path, "id"), "node id must not be empty")
	}
	if parentID, ok := object["parentId"]; ok {
		if _, problem := checkText(parentID, at(path, "parentId"), limits); problem != nil {
			return problem
		}
	}
	role, ok := object["role"].(string)
	if !ok || !ValidRole(Role(role)) {
		return fail(at(path, "role"), "expected one of the v1 semantic roles")
	}
	if _, problem := checkText(object["name"], at(path, "name"), limits); problem != nil {
		return problem
	}
	for _, key := range []string{"description", "value", "testId"} {
		if present, ok := object[key]; ok {
			if _, problem := checkText(present, at(path, key), limits); problem != nil {
				return problem
			}
		}
	}
	if bounds, ok := object["bounds"]; ok {
		if _, problem := checkRect(bounds, at(path, "bounds")); problem != nil {
			return problem
		}
	}
	if state, ok := object["state"]; ok {
		if problem := checkState(state, at(path, "state")); problem != nil {
			return problem
		}
	}
	if actions, ok := object["actions"]; ok {
		items, isArray := actions.([]any)
		if !isArray {
			return fail(at(path, "actions"), "expected an array")
		}
		if len(items) > ActionCount {
			return failBig(at(path, "actions"), "too many actions")
		}
		for index, item := range items {
			name, isString := item.(string)
			if !isString || !ValidAction(Action(name)) {
				return fail(at(path, "actions", fmt.Sprint(index)), "expected one of the v1 semantic actions")
			}
		}
	}
	for _, key := range []string{"labelledBy", "describedBy"} {
		if present, ok := object[key]; ok {
			if problem := checkRelations(present, at(path, key), limits); problem != nil {
				return problem
			}
		}
	}
	if ranges, ok := object["textRanges"]; ok {
		items, isArray := ranges.([]any)
		if !isArray {
			return fail(at(path, "textRanges"), "expected an array")
		}
		if len(items) > limits.MaxRelationTargets {
			return failBig(at(path, "textRanges"), "too many text ranges")
		}
		for index, item := range items {
			itemPath := at(path, "textRanges", fmt.Sprint(index))
			entry, problem := checkObject(item, itemPath)
			if problem != nil {
				return problem
			}
			if problem := checkStrict(entry, []string{"startOffset", "endOffset", "rect"}, itemPath); problem != nil {
				return problem
			}
			for _, key := range []string{"startOffset", "endOffset"} {
				if _, problem := checkNonNegative(entry[key], at(itemPath, key)); problem != nil {
					return problem
				}
			}
			if _, problem := checkRect(entry["rect"], at(itemPath, "rect")); problem != nil {
				return problem
			}
		}
	}
	return nil
}

func checkCursor(value any, path []string) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(object, []string{"row", "column", "visible", "shape"}, path); problem != nil {
		return problem
	}
	for _, key := range []string{"row", "column"} {
		if _, problem := checkNonNegative(object[key], at(path, key)); problem != nil {
			return problem
		}
	}
	if _, problem := checkBool(object["visible"], at(path, "visible")); problem != nil {
		return problem
	}
	if shape, ok := object["shape"]; ok {
		if shape != "block" && shape != "underline" && shape != "bar" {
			return fail(at(path, "shape"), "expected 'block', 'underline' or 'bar'")
		}
	}
	return nil
}

var snapshotKeys = []string{"v", "sessionId", "revision", "columns", "rows", "cursor", "rootIds", "nodes"}

func checkSnapshotSchema(value any, limits Limits) *issue {
	object, problem := checkObject(value, nil)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(object, snapshotKeys, nil); problem != nil {
		return problem
	}
	if version, ok := object["v"].(float64); !ok || version != 1 {
		return fail([]string{"v"}, "expected the literal 1")
	}
	sessionID, problem := checkText(object["sessionId"], []string{"sessionId"}, limits)
	if problem != nil {
		return problem
	}
	if sessionID == "" {
		return fail([]string{"sessionId"}, "sessionId must not be empty")
	}
	if _, problem := checkPositive(object["revision"], []string{"revision"}); problem != nil {
		return problem
	}
	for _, key := range []string{"columns", "rows"} {
		if _, problem := checkPositive(object[key], []string{key}); problem != nil {
			return problem
		}
	}
	if cursor, ok := object["cursor"]; ok {
		if problem := checkCursor(cursor, []string{"cursor"}); problem != nil {
			return problem
		}
	}

	rootIDs, ok := object["rootIds"].([]any)
	if !ok {
		return fail([]string{"rootIds"}, "expected an array")
	}
	if len(rootIDs) > limits.MaxNodes {
		return failBig([]string{"rootIds"}, fmt.Sprintf("expected at most %d items", limits.MaxNodes))
	}
	for index, item := range rootIDs {
		if _, problem := checkText(item, []string{"rootIds", fmt.Sprint(index)}, limits); problem != nil {
			return problem
		}
	}

	nodes, ok := object["nodes"].([]any)
	if !ok {
		return fail([]string{"nodes"}, "expected an array")
	}
	if len(nodes) > limits.MaxNodes {
		return failBig([]string{"nodes"}, fmt.Sprintf("expected at most %d items", limits.MaxNodes))
	}
	for index, node := range nodes {
		if problem := checkNodeSchema(node, []string{"nodes", fmt.Sprint(index)}, limits); problem != nil {
			return problem
		}
	}
	return nil
}

// -- structural layer ------------------------------------------------------

func rectIntersectsViewport(rect map[string]float64, columns, rows float64) bool {
	if rect["width"] == 0 || rect["height"] == 0 {
		return false
	}
	return rect["column"] < columns && rect["row"] < rows &&
		rect["column"]+rect["width"] > 0 && rect["row"]+rect["height"] > 0
}

func stringOr(value any) string {
	text, _ := value.(string)
	return text
}

func checkNodeShape(node map[string]any, columns, rows float64, ids map[string]struct{}, limits Limits) *ValidationError {
	id := stringOr(node["id"])
	if boundsValue, ok := node["bounds"]; ok {
		rect, _ := checkRect(boundsValue, nil)
		if math.Abs(rect["row"]+rect["height"]) > maxSafeInteger ||
			math.Abs(rect["column"]+rect["width"]) > maxSafeInteger {
			return invalid("bad-rect", "node %s: bounds overflow the safe-integer range", id)
		}
		hidden := false
		if state, ok := node["state"].(map[string]any); ok {
			hidden, _ = state["hidden"].(bool)
		}
		if !hidden && !rectIntersectsViewport(rect, columns, rows) {
			return invalid("bad-rect",
				"node %s: bounds do not intersect the %gx%g viewport and the node is not hidden",
				id, columns, rows)
		}
	}

	if ranges, ok := node["textRanges"].([]any); ok {
		for _, item := range ranges {
			entry, _ := item.(map[string]any)
			start, _ := entry["startOffset"].(float64)
			end, _ := entry["endOffset"].(float64)
			if end < start {
				return invalid("bad-rect", "node %s: text range ends before it starts", id)
			}
			rect, _ := checkRect(entry["rect"], nil)
			if math.Abs(rect["row"]+rect["height"]) > maxSafeInteger {
				return invalid("bad-rect", "node %s: text range rect overflows the safe-integer range", id)
			}
		}
	}

	for _, field := range []string{"labelledBy", "describedBy"} {
		targets, ok := node[field].([]any)
		if !ok {
			continue
		}
		if len(targets) > limits.MaxRelationTargets {
			return invalid("count", "node %s: %s exceeds %d targets", id, field, limits.MaxRelationTargets)
		}
		for _, target := range targets {
			if _, known := ids[stringOr(target)]; !known {
				return invalid("missing-parent", "node %s: %s references unknown node %s", id, field, stringOr(target))
			}
		}
	}
	return nil
}

// computeDepths returns every node's depth (roots at 1), or the id at which a
// parent chain closes on itself.
func computeDepths(nodes []map[string]any, byID map[string]map[string]any) (map[string]int, string) {
	depths := make(map[string]int, len(nodes))
	for _, start := range nodes {
		if _, done := depths[stringOr(start["id"])]; done {
			continue
		}
		var chain []string
		onChain := make(map[string]struct{})
		current := start
		for current != nil {
			id := stringOr(current["id"])
			if _, done := depths[id]; done {
				break
			}
			if _, looped := onChain[id]; looped {
				return nil, id
			}
			onChain[id] = struct{}{}
			chain = append(chain, id)
			parentID, hasParent := current["parentId"].(string)
			if !hasParent {
				current = nil
				break
			}
			current = byID[parentID]
		}
		depth := 0
		if current != nil {
			depth = depths[stringOr(current["id"])]
		}
		for index := len(chain) - 1; index >= 0; index-- {
			depth++
			depths[chain[index]] = depth
		}
	}
	return depths, ""
}

var deltaKeys = []string{"type", "baseRevision", "revision", "changed", "removed", "rootIds", "cursor"}

// ValidateTreeDelta checks the SHAPE of a tree-delta message.
//
// Only the shape is checkable here. A delta carries no columns/rows, so
// whether a parent exists, whether the tree stays acyclic and inside the depth
// ceiling, and whether bounds or the cursor fall within the viewport can only
// be judged once the delta is applied to its base — put the assembled tree
// through ValidateSnapshot for that.
//
// What is checkable without the base: sizes, node shape, unique ids, a
// revision that moves forward, and the same id never both upserted and removed
// by one delta.
func ValidateTreeDelta(value any, limits Limits) error {
	projected, err := ProjectDTO(value, limits.MaxDepth)
	if err != nil {
		code := "schema"
		if ViolationCode(err) == "dto-depth" {
			code = "depth"
		}
		return invalid(code, "%s", err.Error())
	}

	serialised, err := marshalCanonical(projected)
	if err != nil {
		return invalid("schema", "delta is not JSON-serialisable")
	}
	if len(serialised) > limits.MaxSnapshotBytes {
		return invalid("bytes", "delta is %d bytes, ceiling is %d", len(serialised), limits.MaxSnapshotBytes)
	}

	if problem := checkTreeDeltaSchema(projected, limits); problem != nil {
		return problem.toError()
	}
	delta := projected.(map[string]any)

	changedIDs := map[string]struct{}{}
	for _, raw := range delta["changed"].([]any) {
		node := raw.(map[string]any)
		id := stringOr(node["id"])
		if _, duplicate := changedIDs[id]; duplicate {
			return invalid("duplicate-id", "node id %s appears twice in changed", id)
		}
		changedIDs[id] = struct{}{}
		if parent, ok := node["parentId"].(string); ok && parent == id {
			return invalid("cycle", "node %s is its own parent", id)
		}
	}

	removedIDs := map[string]struct{}{}
	for _, raw := range delta["removed"].([]any) {
		id := stringOr(raw)
		if _, duplicate := removedIDs[id]; duplicate {
			return invalid("duplicate-id", "node id %s appears twice in removed", id)
		}
		removedIDs[id] = struct{}{}
	}

	for id := range changedIDs {
		if _, both := removedIDs[id]; both {
			// Removals apply before upserts, so this would be a delta arguing
			// with itself about one id rather than moving a node elsewhere.
			return invalid("schema", "node id %s is both changed and removed by one delta", id)
		}
	}

	if rootIDs, present := delta["rootIds"]; present {
		seen := map[string]struct{}{}
		for _, raw := range rootIDs.([]any) {
			id := stringOr(raw)
			if _, duplicate := seen[id]; duplicate {
				return invalid("duplicate-id", "root id %s appears more than once", id)
			}
			seen[id] = struct{}{}
		}
	}
	return nil
}

func checkTreeDeltaSchema(value any, limits Limits) *issue {
	delta, problem := checkObject(value, nil)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(delta, deltaKeys, nil); problem != nil {
		return problem
	}

	base, problem := checkPositive(delta["baseRevision"], []string{"baseRevision"})
	if problem != nil {
		return problem
	}
	revision, problem := checkPositive(delta["revision"], []string{"revision"})
	if problem != nil {
		return problem
	}
	if revision <= base {
		return fail([]string{"revision"},
			fmt.Sprintf("revision %g must move forward from base %g", revision, base))
	}

	changed, ok := delta["changed"].([]any)
	if !ok {
		return fail([]string{"changed"}, "expected an array")
	}
	if len(changed) > limits.MaxNodes {
		return failBig([]string{"changed"}, fmt.Sprintf("expected at most %d items", limits.MaxNodes))
	}
	for index, node := range changed {
		if problem := checkNodeSchema(node, []string{"changed", fmt.Sprint(index)}, limits); problem != nil {
			return problem
		}
	}

	removed, ok := delta["removed"].([]any)
	if !ok {
		return fail([]string{"removed"}, "expected an array")
	}
	if len(removed) > limits.MaxNodes {
		return failBig([]string{"removed"}, fmt.Sprintf("expected at most %d items", limits.MaxNodes))
	}
	for index, id := range removed {
		text, problem := checkText(id, []string{"removed", fmt.Sprint(index)}, limits)
		if problem != nil {
			return problem
		}
		if text == "" {
			return fail([]string{"removed", fmt.Sprint(index)}, "node id must not be empty")
		}
	}

	if rootIDs, present := delta["rootIds"]; present {
		items, ok := rootIDs.([]any)
		if !ok {
			return fail([]string{"rootIds"}, "expected an array")
		}
		if len(items) > limits.MaxNodes {
			return failBig([]string{"rootIds"}, fmt.Sprintf("expected at most %d items", limits.MaxNodes))
		}
		for index, id := range items {
			if _, problem := checkText(id, []string{"rootIds", fmt.Sprint(index)}, limits); problem != nil {
				return problem
			}
		}
	}

	if cursor, present := delta["cursor"]; present {
		if problem := checkCursor(cursor, []string{"cursor"}); problem != nil {
			return problem
		}
	}
	return nil
}

// ValidateSnapshot checks an untrusted snapshot against limits: unique ids,
// existing and acyclic parents, closed role/action/state vocabularies, bounded
// strings and counts, and rects that intersect the viewport unless hidden.
//
// Returns nil when the snapshot is acceptable, or a *ValidationError. Never
// panics on hostile input.
func ValidateSnapshot(value any, limits Limits) error {
	projected, err := ProjectDTO(value, limits.MaxDepth)
	if err != nil {
		if ViolationCode(err) == "dto-depth" {
			return invalid("depth", "%s", err.Error())
		}
		return invalid("schema", "%s", err.Error())
	}

	serialised, err := marshalCanonical(projected)
	if err != nil {
		return invalid("schema", "snapshot is not JSON-serialisable")
	}
	if len(serialised) > limits.MaxSnapshotBytes {
		return invalid("bytes", "snapshot is %d bytes, ceiling is %d", len(serialised), limits.MaxSnapshotBytes)
	}

	if problem := checkSnapshotSchema(projected, limits); problem != nil {
		return problem.toError()
	}

	snapshot := projected.(map[string]any)
	columns := snapshot["columns"].(float64)
	rows := snapshot["rows"].(float64)

	rawNodes := snapshot["nodes"].([]any)
	if len(rawNodes) > limits.MaxNodes {
		return invalid("count", "snapshot carries %d nodes, ceiling is %d", len(rawNodes), limits.MaxNodes)
	}
	nodes := make([]map[string]any, 0, len(rawNodes))
	byID := make(map[string]map[string]any, len(rawNodes))
	for _, raw := range rawNodes {
		node := raw.(map[string]any)
		id := stringOr(node["id"])
		if _, duplicate := byID[id]; duplicate {
			return invalid("duplicate-id", "node id %s appears more than once", id)
		}
		byID[id] = node
		nodes = append(nodes, node)
	}

	rootIDs := make(map[string]struct{})
	for _, raw := range snapshot["rootIds"].([]any) {
		id := stringOr(raw)
		if _, duplicate := rootIDs[id]; duplicate {
			return invalid("duplicate-id", "root id %s appears more than once", id)
		}
		rootIDs[id] = struct{}{}
		node, known := byID[id]
		if !known {
			return invalid("missing-parent", "rootIds references unknown node %s", id)
		}
		if _, hasParent := node["parentId"]; hasParent {
			return invalid("schema", "root node %s declares a parent", id)
		}
	}

	ids := make(map[string]struct{}, len(byID))
	for id := range byID {
		ids[id] = struct{}{}
	}

	for _, node := range nodes {
		id := stringOr(node["id"])
		parentID, hasParent := node["parentId"].(string)
		switch {
		case !hasParent:
			if _, isRoot := rootIDs[id]; !isRoot {
				return invalid("schema", "parentless node %s is missing from rootIds", id)
			}
		case byID[parentID] == nil:
			return invalid("missing-parent", "node %s references unknown parent %s", id, parentID)
		case parentID == id:
			return invalid("cycle", "node %s is its own parent", id)
		}
		if problem := checkNodeShape(node, columns, rows, ids, limits); problem != nil {
			return problem
		}
	}

	depths, cycleAt := computeDepths(nodes, byID)
	if cycleAt != "" {
		return invalid("cycle", "parent chain through node %s is cyclic", cycleAt)
	}
	for id, depth := range depths {
		if depth > limits.MaxDepth {
			return invalid("depth", "node %s sits at depth %d, ceiling is %d", id, depth, limits.MaxDepth)
		}
	}

	if cursorValue, ok := snapshot["cursor"]; ok {
		cursor := cursorValue.(map[string]any)
		row := cursor["row"].(float64)
		column := cursor["column"].(float64)
		if row >= rows || column >= columns {
			return invalid("bad-rect", "cursor (%g, %g) lies outside the viewport", row, column)
		}
	}
	return nil
}

// Validate marshals the snapshot and runs it through ValidateSnapshot, so an
// adapter checks exactly the bytes the driver will see.
func (s *Snapshot) Validate(limits Limits) error {
	body, err := marshalCanonical(s)
	if err != nil {
		return invalid("schema", "snapshot is not JSON-serialisable")
	}
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return invalid("schema", "snapshot is not JSON-serialisable")
	}
	return ValidateSnapshot(parsed, limits)
}
