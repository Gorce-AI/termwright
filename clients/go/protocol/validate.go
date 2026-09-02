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
	if contains(i.path, "bounds") || contains(i.path, "rect") || contains(i.path, "regionBounds") || contains(i.path, "paintedRegion") || contains(i.path, "paintedRegions") {
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
	"busy", "hidden", "offscreen", "readonly", "multiline",
}

var stateKeys = append(append([]string{}, stateBoolKeys...),
	"checked", "orientation", "level", "positionInSet", "setSize")

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
	for _, key := range []string{"setSize"} {
		if present, ok := object[key]; ok {
			if _, problem := checkNonNegative(present, at(path, key)); problem != nil {
				return problem
			}
		}
	}
	return nil
}

var nodeKeys = []string{
	"id", "parentId", "role", "name", "description", "value", "geometry",
	"state", "extended", "actions", "inputRecipes", "labelledBy", "describedBy", "textRanges", "testId",
	"frameworkType", "opaqueChildren", "p", "px",
	"scroll", "paintedRegion",
}

var evidenceKeys = []string{"source", "method", "strength", "providerId"}

func checkEvidence(value any, path []string, limits Limits) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(object, evidenceKeys, path); problem != nil {
		return problem
	}
	source, _ := object["source"].(string)
	if !oneOf(source, []string{"framework", "application", "terminal", "recognizer", "driver"}) {
		return fail(at(path, "source"), "invalid evidence source")
	}
	method, _ := object["method"].(string)
	if !oneOf(method, []string{"native", "instrumented", "declared", "correlated", "measured", "derived", "heuristic"}) {
		return fail(at(path, "method"), "invalid evidence method")
	}
	strength, _ := object["strength"].(string)
	if strength != "authoritative" && strength != "diagnostic" {
		return fail(at(path, "strength"), "invalid evidence strength")
	}
	provider, problem := checkText(object["providerId"], at(path, "providerId"), limits)
	if problem != nil {
		return problem
	}
	if provider == "" {
		return fail(at(path, "providerId"), "providerId must not be empty")
	}
	return nil
}

func checkPaintedRegion(value any, path []string, limits Limits) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	if problem := checkStrict(object, []string{"regionBounds", "spans"}, path); problem != nil {
		return problem
	}
	bounds, problem := checkRect(object["regionBounds"], at(path, "regionBounds"))
	if problem != nil {
		return problem
	}
	spans, ok := object["spans"].([]any)
	if !ok {
		return fail(at(path, "spans"), "expected an array")
	}
	if len(spans) > limits.MaxNodes {
		return failBig(at(path, "spans"), "too many painted spans")
	}
	var previousRow, previousTo float64 = -1, -1
	for index, raw := range spans {
		spanPath := at(path, "spans", fmt.Sprint(index))
		span, problem := checkObject(raw, spanPath)
		if problem != nil {
			return problem
		}
		if problem := checkStrict(span, []string{"row", "from", "to"}, spanPath); problem != nil {
			return problem
		}
		row, problem := checkNonNegative(span["row"], at(spanPath, "row"))
		if problem != nil {
			return problem
		}
		from, problem := checkNonNegative(span["from"], at(spanPath, "from"))
		if problem != nil {
			return problem
		}
		to, problem := checkPositive(span["to"], at(spanPath, "to"))
		if problem != nil {
			return problem
		}
		if to <= from {
			return fail(spanPath, "region span must be non-empty")
		}
		if row < previousRow || (row == previousRow && from < previousTo) {
			return fail(spanPath, "region spans must be non-overlapping row-major runs")
		}
		if row < bounds["row"] || row >= bounds["row"]+bounds["height"] || from < bounds["column"] || to > bounds["column"]+bounds["width"] {
			return fail(spanPath, "region span lies outside regionBounds")
		}
		previousRow, previousTo = row, to
	}
	return nil
}

func checkObservation(value any, path []string, limits Limits, known func(any, []string) *issue) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	status, _ := object["status"].(string)
	switch status {
	case "known":
		if problem := checkStrict(object, []string{"status", "value", "evidence"}, path); problem != nil {
			return problem
		}
		if problem := checkEvidence(object["evidence"], at(path, "evidence"), limits); problem != nil {
			return problem
		}
		return known(object["value"], at(path, "value"))
	case "absent":
		if problem := checkStrict(object, []string{"status", "reason", "evidence"}, path); problem != nil {
			return problem
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"detached", "not-displayed", "not-laid-out"}) {
			return fail(at(path, "reason"), "invalid absent reason")
		}
		if problem := checkEvidence(object["evidence"], at(path, "evidence"), limits); problem != nil {
			return problem
		}
		evidence := object["evidence"].(map[string]any)
		if evidence["strength"] != "authoritative" {
			return fail(at(path, "evidence", "strength"), "absent observation requires authoritative evidence")
		}
		return nil
	case "unknown":
		if problem := checkStrict(object, []string{"status", "reason"}, path); problem != nil {
			return problem
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"awaiting-revision-pair", "provider-refresh", "stale-revision"}) {
			return fail(at(path, "reason"), "invalid unknown reason")
		}
		return nil
	case "unsupported":
		if problem := checkStrict(object, []string{"status", "capability", "reason"}, path); problem != nil {
			return problem
		}
		if _, problem := checkText(object["capability"], at(path, "capability"), limits); problem != nil {
			return problem
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"capability", "framework-unobservable", "not-negotiated"}) {
			return fail(at(path, "reason"), "invalid unsupported reason")
		}
		return nil
	default:
		return fail(at(path, "status"), "invalid observation status")
	}
}

func checkSemanticValue(value any, path []string, limits Limits) *issue {
	object, problem := checkObject(value, path)
	if problem != nil {
		return problem
	}
	status, _ := object["status"].(string)
	sensitivity := func() *issue {
		value, _ := object["sensitivity"].(string)
		if !oneOf(value, []string{"public", "sensitive"}) {
			return fail(at(path, "sensitivity"), "invalid semantic value sensitivity")
		}
		return nil
	}
	switch status {
	case "known":
		if problem := checkStrict(object, []string{"status", "value", "sensitivity", "evidence"}, path); problem != nil {
			return problem
		}
		if _, problem := checkText(object["value"], at(path, "value"), limits); problem != nil {
			return problem
		}
		if problem := sensitivity(); problem != nil {
			return problem
		}
		return checkEvidence(object["evidence"], at(path, "evidence"), limits)
	case "absent":
		if problem := checkStrict(object, []string{"status", "reason", "evidence"}, path); problem != nil {
			return problem
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"detached", "not-displayed", "not-laid-out", "no-value"}) {
			return fail(at(path, "reason"), "invalid semantic value absent reason")
		}
		if problem := checkEvidence(object["evidence"], at(path, "evidence"), limits); problem != nil {
			return problem
		}
		if object["evidence"].(map[string]any)["strength"] != "authoritative" {
			return fail(at(path, "evidence", "strength"), "absent semantic value requires authoritative evidence")
		}
		return nil
	case "unknown":
		if problem := checkStrict(object, []string{"status", "reason"}, path); problem != nil {
			return problem
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"awaiting-revision-pair", "provider-refresh", "stale-revision"}) {
			return fail(at(path, "reason"), "invalid semantic value unknown reason")
		}
		return nil
	case "unsupported":
		if problem := checkStrict(object, []string{"status", "capability", "reason"}, path); problem != nil {
			return problem
		}
		if object["capability"] != "semantic-value" {
			return fail(at(path, "capability"), "expected semantic-value capability")
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"capability", "framework-unobservable", "not-negotiated"}) {
			return fail(at(path, "reason"), "invalid semantic value unsupported reason")
		}
		return nil
	case "withheld":
		if problem := checkStrict(object, []string{"status", "reason", "sensitivity"}, path); problem != nil {
			return problem
		}
		if reason, _ := object["reason"].(string); !oneOf(reason, []string{"sensitive", "artifact-policy", "provider-policy"}) {
			return fail(at(path, "reason"), "invalid semantic value withheld reason")
		}
		return sensitivity()
	default:
		return fail(at(path, "status"), "invalid semantic value status")
	}
}

func checkExtended(value any, path []string, limits Limits) *issue {
	switch typed := value.(type) {
	case nil, bool:
		return nil
	case string:
		_, problem := checkText(typed, path, limits)
		return problem
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Abs(typed) > maxSafeInteger {
			return fail(path, "expected a finite JSON number in the safe range")
		}
		return nil
	case []any:
		if len(typed) > limits.MaxRelationTargets {
			return failBig(path, fmt.Sprintf("expected at most %d items", limits.MaxRelationTargets))
		}
		for index, item := range typed {
			if problem := checkExtended(item, at(path, fmt.Sprint(index)), limits); problem != nil {
				return problem
			}
		}
		return nil
	case map[string]any:
		if len(typed) > limits.MaxRelationTargets {
			return failBig(path, fmt.Sprintf("expected at most %d properties", limits.MaxRelationTargets))
		}
		for key, item := range typed {
			if _, problem := checkText(key, at(path, key), limits); problem != nil {
				return problem
			}
			if problem := checkExtended(item, at(path, key), limits); problem != nil {
				return problem
			}
		}
		return nil
	default:
		return fail(path, "expected JSON scalar, array or object")
	}
}

func oneOf(value string, allowed []string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
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

var physicalInputRecipeActions = map[string]struct{}{
	"focus": {}, "activate": {}, "toggle": {}, "setValue": {},
}

func checkInputRecipes(value any, path []string, limits Limits) *issue {
	items, isArray := value.([]any)
	if !isArray {
		return fail(path, "expected an array")
	}
	if len(items) > len(physicalInputRecipeActions) {
		return failBig(path, "too many input recipes")
	}
	seen := map[string]struct{}{}
	for index, item := range items {
		itemPath := at(path, fmt.Sprint(index))
		recipe, problem := checkObject(item, itemPath)
		if problem != nil {
			return problem
		}
		if problem := checkStrict(recipe, []string{"action", "requiresFocus", "steps"}, itemPath); problem != nil {
			return problem
		}
		action, problem := checkText(recipe["action"], at(itemPath, "action"), limits)
		if problem != nil {
			return problem
		}
		if _, ok := physicalInputRecipeActions[action]; !ok {
			return fail(at(itemPath, "action"), "expected one of the physical input recipe actions")
		}
		if _, duplicate := seen[action]; duplicate {
			return fail(at(itemPath, "action"), "input recipe actions must be unique")
		}
		seen[action] = struct{}{}
		requiresFocus, problem := checkBool(recipe["requiresFocus"], at(itemPath, "requiresFocus"))
		if problem != nil {
			return problem
		}
		if action == "focus" && requiresFocus {
			return fail(at(itemPath, "requiresFocus"), "focus recipe cannot require focus")
		}
		steps, ok := recipe["steps"].([]any)
		if !ok {
			return fail(at(itemPath, "steps"), "expected an array")
		}
		if len(steps) == 0 {
			return fail(at(itemPath, "steps"), "expected at least one step")
		}
		if len(steps) > limits.MaxRelationTargets {
			return failBig(at(itemPath, "steps"), "too many recipe steps")
		}
		insertCount := 0
		for stepIndex, rawStep := range steps {
			stepPath := at(itemPath, "steps", fmt.Sprint(stepIndex))
			step, problem := checkObject(rawStep, stepPath)
			if problem != nil {
				return problem
			}
			kind, problem := checkText(step["kind"], at(stepPath, "kind"), limits)
			if problem != nil {
				return problem
			}
			switch kind {
			case "press":
				if problem := checkStrict(step, []string{"kind", "key"}, stepPath); problem != nil {
					return problem
				}
				key, problem := checkText(step["key"], at(stepPath, "key"), limits)
				if problem != nil {
					return problem
				}
				if key == "" {
					return fail(at(stepPath, "key"), "key must not be empty")
				}
			case "insert-action-value":
				if problem := checkStrict(step, []string{"kind"}, stepPath); problem != nil {
					return problem
				}
				insertCount++
			default:
				return fail(at(stepPath, "kind"), "expected a physical input recipe step")
			}
		}
		if (action == "setValue" && insertCount != 1) || (action != "setValue" && insertCount != 0) {
			return fail(at(itemPath, "steps"), "setValue requires exactly one insert-action-value step")
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
		return fail(at(path, "role"), "expected a semantic role")
	}
	if _, problem := checkText(object["name"], at(path, "name"), limits); problem != nil {
		return problem
	}
	for _, key := range []string{"description", "testId", "frameworkType"} {
		if present, ok := object[key]; ok {
			if _, problem := checkText(present, at(path, key), limits); problem != nil {
				return problem
			}
		}
	}
	if opaque, ok := object["opaqueChildren"]; ok {
		if _, isBool := opaque.(bool); !isBool {
			return fail(at(path, "opaqueChildren"), "expected boolean")
		}
	}
	if present, ok := object["value"]; ok {
		if problem := checkSemanticValue(present, at(path, "value"), limits); problem != nil {
			return problem
		}
	}
	if source, ok := object["p"]; ok {
		text, isText := source.(string)
		if !isText || !oneOf(text, ProvenanceSources) {
			return fail(at(path, "p"), "expected one of the provenance sources")
		}
	}
	if perField, ok := object["px"]; ok {
		fields, isObject := perField.(map[string]any)
		if !isObject {
			return fail(at(path, "px"), "expected an object")
		}
		for field, source := range fields {
			if _, problem := checkText(field, at(path, "px", field), limits); problem != nil {
				return problem
			}
			text, isText := source.(string)
			if !isText || !oneOf(text, ProvenanceSources) {
				return fail(at(path, "px", field), "expected one of the provenance sources")
			}
		}
	}
	if Role(role) == RoleGeneric {
		// An unrecognised widget must at least name what the framework called
		// it. An empty string carries no more than its absence, so both fail.
		framework, _ := object["frameworkType"].(string)
		if framework == "" {
			return fail(at(path, "frameworkType"), fmt.Sprintf(
				"node %s has role 'generic' without a frameworkType; an unrecognised widget "+
					"must name what the framework called it", id))
		}
	}
	geometry, problem := checkObject(object["geometry"], at(path, "geometry"))
	if problem != nil {
		return problem
	}
	if problem := checkStrict(geometry, []string{"displayed", "intendedRect", "visibleRect"}, at(path, "geometry")); problem != nil {
		return problem
	}
	if problem := checkObservation(geometry["displayed"], at(path, "geometry", "displayed"), limits, func(v any, p []string) *issue {
		if _, ok := v.(bool); !ok {
			return fail(p, "expected boolean")
		}
		return nil
	}); problem != nil {
		return problem
	}
	for _, field := range []string{"intendedRect", "visibleRect"} {
		if problem := checkObservation(geometry[field], at(path, "geometry", field), limits, func(v any, p []string) *issue { _, issue := checkRect(v, p); return issue }); problem != nil {
			return problem
		}
	}
	if rawScroll, ok := object["scroll"]; ok {
		if problem := checkObservation(rawScroll, at(path, "scroll"), limits, func(v any, p []string) *issue {
			state, problem := checkObject(v, p)
			if problem != nil {
				return problem
			}
			if problem := checkStrict(state, []string{"axis", "offset", "viewport", "extent"}, p); problem != nil {
				return problem
			}
			axis, _ := state["axis"].(string)
			if axis != "vertical" && axis != "horizontal" {
				return fail(at(p, "axis"), "invalid scroll axis")
			}
			values := map[string]float64{}
			for _, key := range []string{"offset", "viewport", "extent"} {
				value, problem := checkNonNegative(state[key], at(p, key))
				if problem != nil {
					return problem
				}
				values[key] = value
			}
			if values["offset"]+values["viewport"] > values["extent"] {
				return fail(p, "scroll state must fit inside its extent")
			}
			return nil
		}); problem != nil {
			return problem
		}
	}
	if rawPaint, ok := object["paintedRegion"]; ok {
		if problem := checkObservation(rawPaint, at(path, "paintedRegion"), limits, func(v any, p []string) *issue {
			return checkPaintedRegion(v, p, limits)
		}); problem != nil {
			return problem
		}
	}
	if state, ok := object["state"]; ok {
		if problem := checkState(state, at(path, "state")); problem != nil {
			return problem
		}
		// Every cell outside the visible area and the node still visible cannot
		// both be true. Refusing the pair keeps `offscreen` a claim about
		// scrolling rather than a second, weaker way of saying hidden.
		if fields, isObject := state.(map[string]any); isObject {
			offscreen, _ := fields["offscreen"].(bool)
			hidden, _ := fields["hidden"].(bool)
			if offscreen && !hidden {
				return fail(at(path, "state", "offscreen"), fmt.Sprintf(
					"node %s: state.offscreen implies state.hidden — every cell is outside "+
						"the visible area, so the node cannot also be visible", id))
			}
		}
	}
	if extended, ok := object["extended"]; ok {
		fields, isObject := extended.(map[string]any)
		if !isObject {
			return fail(at(path, "extended"), "expected an object")
		}
		if problem := checkExtended(fields, at(path, "extended"), limits); problem != nil {
			return problem
		}
	}
	declaredActions := map[string]struct{}{}
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
				return fail(at(path, "actions", fmt.Sprint(index)), "expected a semantic action")
			}
			declaredActions[name] = struct{}{}
		}
	}
	if recipes, ok := object["inputRecipes"]; ok {
		if problem := checkInputRecipes(recipes, at(path, "inputRecipes"), limits); problem != nil {
			return problem
		}
		for index, rawRecipe := range recipes.([]any) {
			recipe := rawRecipe.(map[string]any)
			action := recipe["action"].(string)
			if _, declared := declaredActions[action]; !declared {
				return fail(at(path, "inputRecipes", fmt.Sprint(index), "action"),
					fmt.Sprintf("input recipe %q requires the matching semantic action intent", action))
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

var snapshotKeys = []string{"v", "sessionId", "revision", "columns", "rows", "cursor", "rootIds", "nodes", "coordinateSpace", "hitGrid", "providerEvidence"}

func checkSnapshotSchema(value any, limits Limits) *issue {
	object, problem := checkObject(value, nil)
	if problem != nil {
		return problem
	}
	version, ok := object["v"].(float64)
	if problem := checkStrict(object, snapshotKeys, nil); problem != nil {
		return problem
	}
	if !ok || version != 3 {
		return fail([]string{"v"}, "expected the literal 3")
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
	if raw, present := object["providerEvidence"]; present {
		entries, ok := raw.([]any)
		if !ok {
			return fail([]string{"providerEvidence"}, "expected an array")
		}
		if len(entries) > 64 {
			return failBig([]string{"providerEvidence"}, "expected at most 64 items")
		}
		for index, rawEntry := range entries {
			entryPath := []string{"providerEvidence", fmt.Sprint(index)}
			entry, problem := checkObject(rawEntry, entryPath)
			if problem != nil {
				return problem
			}
			status, problem := checkText(entry["status"], at(entryPath, "status"), limits)
			if problem != nil {
				return problem
			}
			if status != "available" {
				if status != "lost" && status != "violation" {
					return fail(at(entryPath, "status"), "expected available, lost, or violation")
				}
				continue
			}
			if rawFocus, ok := entry["focusState"]; ok {
				focus, problem := checkObject(rawFocus, at(entryPath, "focusState"))
				if problem != nil {
					return problem
				}
				focusStatus, problem := checkText(focus["status"], at(entryPath, "focusState", "status"), limits)
				if problem != nil {
					return problem
				}
				switch focusStatus {
				case "focused":
					if problem := checkStrict(focus, []string{"status", "recipientId"}, at(entryPath, "focusState")); problem != nil {
						return problem
					}
					recipient, problem := checkText(focus["recipientId"], at(entryPath, "focusState", "recipientId"), limits)
					if problem != nil {
						return problem
					}
					if recipient == "" {
						return fail(at(entryPath, "focusState", "recipientId"), "recipient id must not be empty")
					}
				case "none":
					if problem := checkStrict(focus, []string{"status"}, at(entryPath, "focusState")); problem != nil {
						return problem
					}
				default:
					return fail(at(entryPath, "focusState", "status"), "expected focused or none")
				}
			}
			if recipes, ok := entry["actionRecipes"]; ok {
				targets, ok := recipes.([]any)
				if !ok {
					return fail(at(entryPath, "actionRecipes"), "expected an array")
				}
				if len(targets) > limits.MaxNodes {
					return failBig(at(entryPath, "actionRecipes"), "too many action recipe recipients")
				}
				seen := map[string]struct{}{}
				for targetIndex, rawTarget := range targets {
					targetPath := at(entryPath, "actionRecipes", fmt.Sprint(targetIndex))
					target, problem := checkObject(rawTarget, targetPath)
					if problem != nil {
						return problem
					}
					if problem := checkStrict(target, []string{"recipientId", "recipes"}, targetPath); problem != nil {
						return problem
					}
					recipient, problem := checkText(target["recipientId"], at(targetPath, "recipientId"), limits)
					if problem != nil {
						return problem
					}
					if recipient == "" {
						return fail(at(targetPath, "recipientId"), "recipient id must not be empty")
					}
					if _, duplicate := seen[recipient]; duplicate {
						return fail(at(targetPath, "recipientId"), "provider action recipe recipients must be unique")
					}
					seen[recipient] = struct{}{}
					if problem := checkInputRecipes(target["recipes"], at(targetPath, "recipes"), limits); problem != nil {
						return problem
					}
				}
			}
			if rawStates, ok := entry["scrollStates"]; ok {
				states, ok := rawStates.([]any)
				if !ok {
					return fail(at(entryPath, "scrollStates"), "expected an array")
				}
				if len(states) > limits.MaxNodes {
					return failBig(at(entryPath, "scrollStates"), "too many scroll recipients")
				}
				seen := map[string]struct{}{}
				for stateIndex, rawState := range states {
					statePath := at(entryPath, "scrollStates", fmt.Sprint(stateIndex))
					state, problem := checkObject(rawState, statePath)
					if problem != nil {
						return problem
					}
					if problem := checkStrict(state, []string{"recipientId", "axis", "offset", "viewport", "extent"}, statePath); problem != nil {
						return problem
					}
					recipient, problem := checkText(state["recipientId"], at(statePath, "recipientId"), limits)
					if problem != nil {
						return problem
					}
					if recipient == "" {
						return fail(at(statePath, "recipientId"), "recipient id must not be empty")
					}
					if _, exists := seen[recipient]; exists {
						return fail(at(statePath, "recipientId"), "provider scroll recipients must be unique")
					}
					seen[recipient] = struct{}{}
					axis, _ := state["axis"].(string)
					if axis != "vertical" && axis != "horizontal" {
						return fail(at(statePath, "axis"), "invalid scroll axis")
					}
					values := map[string]float64{}
					for _, key := range []string{"offset", "viewport", "extent"} {
						value, problem := checkNonNegative(state[key], at(statePath, key))
						if problem != nil {
							return problem
						}
						values[key] = value
					}
					if values["offset"]+values["viewport"] > values["extent"] {
						return fail(statePath, "scroll state must fit inside its extent")
					}
				}
			}
			if rawRegions, ok := entry["paintedRegions"]; ok {
				regions, ok := rawRegions.([]any)
				if !ok {
					return fail(at(entryPath, "paintedRegions"), "expected an array")
				}
				if len(regions) > limits.MaxNodes {
					return failBig(at(entryPath, "paintedRegions"), "too many painted recipients")
				}
				seen := map[string]struct{}{}
				for regionIndex, rawRegion := range regions {
					regionPath := at(entryPath, "paintedRegions", fmt.Sprint(regionIndex))
					region, problem := checkObject(rawRegion, regionPath)
					if problem != nil {
						return problem
					}
					recipient, problem := checkText(region["recipientId"], at(regionPath, "recipientId"), limits)
					if problem != nil {
						return problem
					}
					if recipient == "" {
						return fail(at(regionPath, "recipientId"), "recipient id must not be empty")
					}
					if _, exists := seen[recipient]; exists {
						return fail(at(regionPath, "recipientId"), "provider painted recipients must be unique")
					}
					seen[recipient] = struct{}{}
					paint := map[string]any{"regionBounds": region["regionBounds"], "spans": region["spans"]}
					if problem := checkPaintedRegion(paint, regionPath, limits); problem != nil {
						return problem
					}
				}
			}
			if rawModes, ok := entry["inputModes"]; ok {
				modesPath := at(entryPath, "inputModes")
				modes, problem := checkObject(rawModes, modesPath)
				if problem != nil {
					return problem
				}
				if problem := checkStrict(modes, []string{"mouseTracking", "mouseEncoding", "focusReporting"}, modesPath); problem != nil {
					return problem
				}
				tracking, _ := modes["mouseTracking"].(string)
				encoding, _ := modes["mouseEncoding"].(string)
				focus, _ := modes["focusReporting"].(string)
				if !contains([]string{"none", "x10", "vt200", "drag", "any"}, tracking) {
					return fail(at(modesPath, "mouseTracking"), "invalid mouse tracking mode")
				}
				if !contains([]string{"default", "sgr", "urxvt", "utf8"}, encoding) {
					return fail(at(modesPath, "mouseEncoding"), "invalid mouse encoding")
				}
				if focus != "on" && focus != "off" {
					return fail(at(modesPath, "focusReporting"), "invalid focus reporting mode")
				}
			}
		}
	}
	if problem := checkObservation(object["coordinateSpace"], []string{"coordinateSpace"}, limits, func(v any, p []string) *issue {
		s, ok := v.(string)
		if !ok || (s != "viewport-cells" && s != "framework-local-cells") {
			return fail(p, "invalid coordinate space")
		}
		return nil
	}); problem != nil {
		return problem
	}
	if problem := checkObservation(object["hitGrid"], []string{"hitGrid"}, limits, func(v any, p []string) *issue {
		grid, issue := checkObject(v, p)
		if issue != nil {
			return issue
		}
		if issue := checkStrict(grid, []string{"regions"}, p); issue != nil {
			return issue
		}
		regions, ok := grid["regions"].([]any)
		if !ok || len(regions) > limits.MaxNodes {
			return fail(at(p, "regions"), "invalid hit regions")
		}
		var previous map[string]float64
		for i, raw := range regions {
			rp := at(p, "regions", fmt.Sprint(i))
			region, issue := checkObject(raw, rp)
			if issue != nil {
				return issue
			}
			if issue := checkStrict(region, []string{"rect", "recipientId"}, rp); issue != nil {
				return issue
			}
			rect, issue := checkRect(region["rect"], at(rp, "rect"))
			if issue != nil {
				return issue
			}
			if rect["width"] <= 0 || rect["height"] != 1 {
				return fail(at(rp, "rect"), "hit regions must be non-empty row runs")
			}
			if previous != nil && (rect["row"] < previous["row"] ||
				(rect["row"] == previous["row"] && rect["column"] < previous["column"]+previous["width"])) {
				return fail(at(rp, "rect"), "hit regions must be non-overlapping row-major runs")
			}
			previous = rect
			if _, issue := checkText(region["recipientId"], at(rp, "recipientId"), limits); issue != nil {
				return issue
			}
		}
		return nil
	}); problem != nil {
		return problem
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
	if painted, ok := node["paintedRegion"].(map[string]any); ok && painted["status"] == "known" {
		value, _ := painted["value"].(map[string]any)
		spans, _ := value["spans"].([]any)
		for _, rawSpan := range spans {
			span, _ := rawSpan.(map[string]any)
			row, _ := span["row"].(float64)
			from, _ := span["from"].(float64)
			to, _ := span["to"].(float64)
			if row >= rows || from >= columns || to > columns {
				return invalid("bad-rect", "node %s painted region span lies outside the viewport", id)
			}
		}
	}
	geometry := node["geometry"].(map[string]any)
	for _, field := range []string{"intendedRect", "visibleRect"} {
		observation := geometry[field].(map[string]any)
		if observation["status"] != "known" {
			continue
		}
		rect, _ := checkRect(observation["value"], nil)
		if math.Abs(rect["row"]+rect["height"]) > maxSafeInteger ||
			math.Abs(rect["column"]+rect["width"]) > maxSafeInteger {
			return invalid("bad-rect", "node %s: geometry.%s overflows the safe-integer range", id, field)
		}
		if field == "visibleRect" && rect["width"] > 0 && rect["height"] > 0 && !rectIntersectsViewport(rect, columns, rows) {
			return invalid("bad-rect",
				"node %s: geometry.visibleRect does not intersect the %gx%g viewport",
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
	if snapshot["v"].(float64) == 3 {
		observation := snapshot["hitGrid"].(map[string]any)
		if observation["status"] == "known" {
			grid := observation["value"].(map[string]any)
			for _, raw := range grid["regions"].([]any) {
				region := raw.(map[string]any)
				recipientID := stringOr(region["recipientId"])
				if _, known := ids[recipientID]; !known {
					return invalid("missing-parent", "hitGrid references unknown recipient %s", recipientID)
				}
				rect, _ := checkRect(region["rect"], nil)
				if !rectIntersectsViewport(rect, columns, rows) {
					return invalid("bad-rect", "hitGrid region for %s does not intersect the viewport", recipientID)
				}
			}
		}
	}
	if providerEvidence, ok := snapshot["providerEvidence"].([]any); ok {
		for _, rawEntry := range providerEvidence {
			entry := rawEntry.(map[string]any)
			if entry["status"] != "available" {
				continue
			}
			providerID := stringOr(entry["providerId"])
			if focus, ok := entry["focusState"].(map[string]any); ok && focus["status"] == "focused" {
				recipientID := stringOr(focus["recipientId"])
				if _, exists := byID[recipientID]; !exists {
					return invalid("missing-parent", "provider %s focus references unknown recipient %s", providerID, recipientID)
				}
			}
			targets, _ := entry["actionRecipes"].([]any)
			for _, rawTarget := range targets {
				target := rawTarget.(map[string]any)
				recipientID := stringOr(target["recipientId"])
				if _, exists := byID[recipientID]; !exists {
					return invalid("missing-parent", "provider %s action recipes reference unknown recipient %s", providerID, recipientID)
				}
			}
			states, _ := entry["scrollStates"].([]any)
			for _, rawState := range states {
				state := rawState.(map[string]any)
				recipientID := stringOr(state["recipientId"])
				if _, exists := byID[recipientID]; !exists {
					return invalid("missing-parent", "provider %s scroll state references unknown recipient %s", providerID, recipientID)
				}
			}
			regions, _ := entry["paintedRegions"].([]any)
			for _, rawRegion := range regions {
				region := rawRegion.(map[string]any)
				recipientID := stringOr(region["recipientId"])
				if _, exists := byID[recipientID]; !exists {
					return invalid("missing-parent", "provider %s painted region references unknown recipient %s", providerID, recipientID)
				}
				spans, _ := region["spans"].([]any)
				for _, rawSpan := range spans {
					span := rawSpan.(map[string]any)
					row, _ := span["row"].(float64)
					from, _ := span["from"].(float64)
					to, _ := span["to"].(float64)
					if row >= rows || from >= columns || to > columns {
						return invalid("bad-rect", "provider %s painted region for %s lies outside the viewport", providerID, recipientID)
					}
				}
			}
		}
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
