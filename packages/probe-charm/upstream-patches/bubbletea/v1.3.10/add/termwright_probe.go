package tea

// Build-time instrumentation injected by termwright into a private copy of
// Bubble Tea v1. Upstream never sees this file.
//
// Charm is shaped nothing like tview, and the difference decides everything
// here. There is no widget tree to walk: the application's state is a struct
// the *user* defined, and the components inside it belong to a different
// module (`charm.land/bubbles/v2`). Being inside `tea` therefore buys the
// frame hook and nothing else — a Bubbles component's unexported fields are as
// far away from here as they are from an external adapter.
//
// So this probe reflects over the user's model, recognises Bubbles components
// by type, and reads them through their **public getters**: `Value()`,
// `Focused()`, `Title()`, `SelectedRow()`. That covers role, name, value and
// focus, which is most of what a test addresses. What it cannot reach — a
// spinner's frame index, a filepicker's selection, a textinput's horizontal
// offset — has no getter at all, and reaching it needs a second patch set
// against Bubbles itself. That is a separate decision, not an oversight.
//
// Geometry is absent on purpose. The frame is one styled string by the time it
// reaches the renderer, and Lip Gloss has already destroyed the mapping from
// fragment to screen region (see docs/architecture/audit/charm.md §3). v2 has
// two channels that could restore it — the layer compositor and per-cell OSC 8
// parameters — and until one is wired the probe reports component and value
// without a position rather than inventing coordinates.

import (
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/evidence"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

const (
	probeName        = "termwright-probe-charm"
	probeVersion     = "0.2.0"
	frameworkVersion = "v1.3.10"
)

type termwrightProbeState struct {
	client *protocol.Client

	mu        sync.Mutex
	ids       map[string]string
	nextID    int
	pendingMu sync.Mutex
	pending   *protocol.Snapshot
	publishMu sync.Mutex
	frames    atomic.Uint64
	dropped   atomic.Uint64
}

var (
	termwrightProbeOnce sync.Once
	termwrightProbe     *termwrightProbeState
)

func termwrightCurrentProbe() *termwrightProbeState {
	termwrightProbeOnce.Do(func() { termwrightProbe = newTermwrightProbe() })
	return termwrightProbe
}

func newTermwrightProbe() *termwrightProbeState {
	client := protocol.FromEnv(protocol.Options{
		AdapterName:    probeName,
		AdapterVersion: probeVersion,
		Probe: &protocol.ProbeInfo{
			Framework:        "charm",
			FrameworkVersion: frameworkVersion,
			ProbeVersion:     probeVersion,
			// Bubble Tea copies application models through Update; a synthetic
			// field path is useful inside one frame but is not object identity.
			IdentityKind: protocol.ProbeIdentityFrameLocal,
			Capabilities: []protocol.ProbeCapability{
				protocol.ProbeCapAnnotations,
			},
		},
		// Charm publishes a tree, observable component state, descriptive action
		// hints and a marker for each accepted revision. Actions still execute
		// through terminal input; annotations never install callbacks.
		Capabilities: []protocol.Capability{
			protocol.CapTree,
			protocol.CapStates,
			protocol.CapFocusState,
			protocol.CapActions,
			protocol.CapRenderRevisions,
		},
		// The publish happens on the event-loop goroutine, between Update and
		// the renderer. An unbounded write would stall the loop whenever the
		// driver stops reading.
		WriteTimeout:      protocol.DefaultWriteTimeout,
		EvidenceProviders: evidence.DefaultRegistry(),
	})
	if client == nil {
		return nil
	}
	p := &termwrightProbeState{client: client, ids: make(map[string]string)}
	go func() {
		if client.Start(protocol.DialTimeout) != nil {
			return
		}
		p.pendingMu.Lock()
		pending := p.pending
		p.pending = nil
		p.pendingMu.Unlock()
		if pending != nil {
			p.publish(pending)
		}
	}()
	return p
}

// termwrightAfterView is called with the model that produced this frame.
//
// Three call sites here, where v2 has one. It is not a style choice: v1 hands
// the renderer a plain string through `renderer.write`, and a probe anchored
// there would receive the frame without the model — with nothing to read. The
// model is only in scope at the three places that call View(), so the patch
// touches all three.
func termwrightAfterView(program *Program, model Model, view string) {
	p := termwrightCurrentProbe()
	if p == nil {
		return
	}

	// v1 keeps the terminal size on the renderer, not on the Program — the
	// symmetry with v2 that looks obvious is not there, and assuming it cost a
	// compile. Zero means "the size has not arrived yet", not "a tiny
	// terminal": validation refuses a snapshot without positive dimensions, so
	// the frame is skipped rather than published as a lie.
	columns, rows := termwrightViewport(program)
	if columns <= 0 || rows <= 0 {
		return
	}

	snapshot, duplicateKey := p.snapshot(model, view, columns, rows)
	if duplicateKey != "" {
		_ = p.client.Fail("duplicate-semantic-key", "duplicate SemanticKey: "+string(duplicateKey))
		return
	}
	p.pendingMu.Lock()
	if !p.client.Connected() {
		p.pending = snapshot
		p.pendingMu.Unlock()
		return
	}
	p.pendingMu.Unlock()
	p.publish(snapshot)
}

func (p *termwrightProbeState) publish(snapshot *protocol.Snapshot) {
	p.publishMu.Lock()
	defer p.publishMu.Unlock()
	marker, err := p.client.Publish(snapshot)
	if err != nil || marker == "" {
		p.dropped.Add(1)
		// A dropped frame means this probe lost part of its own fact stream,
		// so the next publication owes the driver a whole tree.
		return
	}
	_, _ = os.Stdout.WriteString(marker)
	p.frames.Add(1)
}

// snapshot reflects over the user's model and reports what it recognises.
func (p *termwrightProbeState) snapshot(model Model, view string, columns, rows int) (*protocol.Snapshot, annotate.SemanticKey) {
	snapshot := termwrightNewSnapshot(columns, rows)

	rootID := p.identity("root")
	snapshot.RootIDs = append(snapshot.RootIDs, rootID)
	root := protocol.Node{
		ID:            rootID,
		Role:          protocol.RoleApplication,
		Name:          termwrightTypeName(model),
		FrameworkType: termwrightTypeName(model),
		P:             protocol.ProvenanceFramework,
		PX: map[string]string{
			"role": protocol.ProvenanceRecognizer,
		},
	}
	termwrightCharmGeometry(&root, true)
	snapshot.Nodes = append(snapshot.Nodes, root)

	candidates := make([]termwrightCandidate, 0)
	p.walk(reflect.ValueOf(model), rootID, "", &candidates, 0)
	duplicateKey := p.appendCandidates(snapshot, rootID, candidates)
	return snapshot, duplicateKey
}

type termwrightCandidate struct {
	identityKey string
	node        protocol.Node
	meta        annotate.Semantics
	annotated   bool
}

type termwrightRelations struct {
	nodeIndex   int
	labelledBy  []annotate.SemanticKey
	describedBy []annotate.SemanticKey
}

// appendCandidates is the second pass. Provider methods are evaluated only
// once in walk; after the complete set is known, unique author keys can safely
// become stable ids and relationships can resolve in either field order.
func (p *termwrightProbeState) appendCandidates(
	snapshot *protocol.Snapshot,
	rootID string,
	candidates []termwrightCandidate,
) annotate.SemanticKey {
	counts := make(map[annotate.SemanticKey]int)
	for _, candidate := range candidates {
		if candidate.annotated && candidate.meta.Key != "" {
			counts[candidate.meta.Key]++
		}
	}
	for _, candidate := range candidates {
		if candidate.annotated && candidate.meta.Key != "" && counts[candidate.meta.Key] > 1 {
			return candidate.meta.Key
		}
	}

	keys := make(map[annotate.SemanticKey]string)
	pending := make([]termwrightRelations, 0)
	for _, candidate := range candidates {
		keyApplied := candidate.annotated && candidate.meta.Key != "" && counts[candidate.meta.Key] == 1
		identityKey := candidate.identityKey
		candidate.node.ID = p.identity(identityKey)
		if keyApplied {
			candidate.node.ID = "k:" + string(candidate.meta.Key)
		}
		candidate.node.ParentID = rootID
		if candidate.annotated {
			termwrightApplyAnnotation(candidate.meta, &candidate.node)
		}
		termwrightCharmGeometry(&candidate.node, false)
		if keyApplied {
			keys[candidate.meta.Key] = candidate.node.ID
			termwrightProvenance(&candidate.node, "id", protocol.ProvenanceAnnotation)
		}
		snapshot.Nodes = append(snapshot.Nodes, candidate.node)
		if candidate.annotated && (len(candidate.meta.LabelledBy) > 0 || len(candidate.meta.DescribedBy) > 0) {
			pending = append(pending, termwrightRelations{
				nodeIndex:   len(snapshot.Nodes) - 1,
				labelledBy:  candidate.meta.LabelledBy,
				describedBy: candidate.meta.DescribedBy,
			})
		}
	}
	maxRelations := protocol.DefaultLimits.MaxRelationTargets
	if p.client != nil {
		maxRelations = p.client.Limits().MaxRelationTargets
	}
	termwrightResolveRelations(snapshot, keys, pending, maxRelations)
	return ""
}

// Bubble Tea exposes the completed View but not a component-to-cell mapping.
// The root is known to have produced this frame; reflected model membership
// alone does not prove that any particular component contributed to View.
func termwrightCharmGeometry(node *protocol.Node, root bool) {
	if root {
		displayed := true
		node.Geometry = protocol.NodeGeometryObservations{
			Displayed:    protocol.Observation[bool]{Status: "known", Value: &displayed, Evidence: termwrightEvidence("instrumented")},
			IntendedRect: protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapIntendedGeometry), Reason: "framework-unobservable"},
			VisibleRect:  protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapClippedGeometry), Reason: "framework-unobservable"},
		}
		return
	}
	node.Geometry = protocol.NodeGeometryObservations{
		Displayed:    protocol.Observation[bool]{Status: "unsupported", Capability: "displayed", Reason: "framework-unobservable"},
		IntendedRect: protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapIntendedGeometry), Reason: "framework-unobservable"},
		VisibleRect:  protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapClippedGeometry), Reason: "framework-unobservable"},
	}
}

func termwrightNewSnapshot(columns, rows int) *protocol.Snapshot {
	snapshot := protocol.NewSnapshot("", 0, columns, rows)
	snapshot.HitGrid = protocol.Observation[protocol.PointerHitGrid]{
		Status: "unsupported", Capability: "pointer-hit-grid", Reason: "framework-unobservable",
	}
	return snapshot
}

func termwrightEvidence(method string) *protocol.EvidenceProvenance {
	return &protocol.EvidenceProvenance{
		Source: "framework", Method: method, Strength: "authoritative", ProviderID: probeName,
	}
}

func termwrightResolveRelations(
	snapshot *protocol.Snapshot,
	keys map[annotate.SemanticKey]string,
	pending []termwrightRelations,
	maxRelations int,
) {
	resolve := func(references []annotate.SemanticKey) []string {
		resolved := make([]string, 0, len(references))
		seen := make(map[string]struct{}, len(references))
		for _, key := range references {
			if len(resolved) >= maxRelations {
				break
			}
			id, found := keys[key]
			if !found {
				continue
			}
			if _, duplicate := seen[id]; duplicate {
				continue
			}
			seen[id] = struct{}{}
			resolved = append(resolved, id)
		}
		return resolved
	}
	for _, relation := range pending {
		node := &snapshot.Nodes[relation.nodeIndex]
		if ids := resolve(relation.labelledBy); len(ids) > 0 {
			node.LabelledBy = ids
			termwrightProvenance(node, "labelledBy", protocol.ProvenanceAnnotation)
		}
		if ids := resolve(relation.describedBy); len(ids) > 0 {
			node.DescribedBy = ids
			termwrightProvenance(node, "describedBy", protocol.ProvenanceAnnotation)
		}
	}
}

// walk descends the user's model looking for components it knows.
//
// Depth-bounded because a user's model is arbitrary: a cyclic or deeply nested
// structure must cost a truncated tree, never the frame.
func (p *termwrightProbeState) walk(
	value reflect.Value,
	parentID string,
	fieldName string,
	candidates *[]termwrightCandidate,
	depth int,
) {
	if depth > 8 || !value.IsValid() {
		return
	}
	for value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface {
		if value.IsNil() {
			return
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return
	}

	// Read intent before recognition, but do not publish it yet. An idiomatic
	// annotated Bubbles component is a local type embedding the native value;
	// returning here would throw away the embedded component's value and state.
	declared, hasDeclared := termwrightDeclaredSemantics(value)

	if component := termwrightRecognise(value, fieldName); component != nil {
		component.node.P = protocol.ProvenanceFramework
		component.node.PX = map[string]string{"role": protocol.ProvenanceRecognizer}
		*candidates = append(*candidates, termwrightCandidate{
			identityKey: parentID + "/" + fieldName + "/" + component.frameworkType,
			node:        component.node,
			meta:        declared,
			annotated:   hasDeclared,
		})
		// A recognised component's own fields are its business; descending
		// into it would report its internals as siblings of the application's.
		return
	}

	// A declared custom component that contains no recognised Bubbles value
	// still reaches the tree as what its author says it is.
	if hasDeclared {
		node := protocol.Node{
			Role:          protocol.RoleGeneric,
			Name:          fieldName,
			FrameworkType: value.Type().Name(),
			P:             protocol.ProvenanceFramework,
			PX: map[string]string{
				"role": protocol.ProvenanceRecognizer,
			},
		}
		*candidates = append(*candidates, termwrightCandidate{
			identityKey: parentID + "/" + fieldName + "/declared",
			node:        node,
			meta:        declared,
			annotated:   true,
		})
		return
	}

	kind := value.Type()
	for index := 0; index < value.NumField(); index++ {
		field := kind.Field(index)
		// Unexported fields of the *user's* struct cannot be read without
		// unsafe, and a probe that reaches into a user's private state to
		// guess at UI is doing something it cannot justify.
		if !field.IsExported() {
			continue
		}
		p.walk(value.Field(index), parentID, field.Name, candidates, depth+1)
	}
}

// recognised is one Bubbles component the probe understood.
type recognised struct {
	frameworkType string
	node          protocol.Node
}

// termwrightRecognise identifies a Bubbles component by its type.
//
// Keyed on package path plus type name, because every Bubbles component is
// called `Model` and the name alone says nothing.
func termwrightRecognise(value reflect.Value, fieldName string) *recognised {
	if component := termwrightRecogniseBubbles(value, fieldName); component != nil {
		return component
	}

	// Applications cannot add methods to a type from another module. The
	// idiomatic way to give a Bubbles value TermwrightSemantics is therefore a
	// local wrapper with an anonymous embedded component. Recognise that native
	// value while applying the wrapper's annotation in walk().
	kind := value.Type()
	for index := 0; index < value.NumField(); index++ {
		field := kind.Field(index)
		if !field.Anonymous || !field.IsExported() {
			continue
		}
		embedded := value.Field(index)
		for embedded.Kind() == reflect.Pointer || embedded.Kind() == reflect.Interface {
			if embedded.IsNil() {
				break
			}
			embedded = embedded.Elem()
		}
		if embedded.IsValid() && embedded.Kind() == reflect.Struct {
			if component := termwrightRecogniseBubbles(embedded, fieldName); component != nil {
				return component
			}
		}
	}
	return nil
}

// termwrightRecogniseBubbles recognises one native Bubbles value.
func termwrightRecogniseBubbles(value reflect.Value, fieldName string) *recognised {
	kind := value.Type()
	path := kind.PkgPath()
	if !strings.Contains(path, "bubbles") {
		return nil
	}
	component := path[strings.LastIndex(path, "/")+1:]

	node := protocol.Node{FrameworkType: component, Name: fieldName}
	switch component {
	case "textinput", "textarea":
		node.Role = protocol.RoleTextbox
		node.State = termwrightFocusState(value)
		// A masked field's contents are not ours to publish. `Value()` returns
		// the secret whatever the widget draws, so a probe that reads it puts
		// a password into the semantic tree, the trace archive and the HTML
		// report — three places nobody expected one. The screen shows dots;
		// so does the tree.
		if termwrightEchoesPlainly(value) {
			node.Value = termwrightSensitiveValue(termwrightCallString(value, "Value"))
		} else {
			node.Value = protocol.WithheldSensitiveValue()
		}
	case "list":
		node.Role = protocol.RoleList
		if title := termwrightCallString(value, "Title"); title != nil && *title != "" {
			node.Name = *title
		}
	case "table":
		node.Role = protocol.RoleTable
		node.State = termwrightFocusState(value)
	case "progress":
		node.Role = protocol.RoleProgressBar
	case "paginator", "viewport", "filepicker":
		node.Role = protocol.RoleRegion
	case "spinner":
		node.Role = protocol.RoleStatus
	default:
		// A component this probe has not been taught still reaches the tree,
		// carrying the name Bubbles gave it.
		node.Role = protocol.RoleGeneric
	}
	// Anything the Bubbles patch set exposes is layered on top; without that
	// patch set these calls find nothing and the node keeps what the public
	// getters gave it.
	termwrightLibraryState(value, component, &node)

	return &recognised{frameworkType: component, node: node}
}

// termwrightDeclaredSemantics asks a value for its own semantics.
//
// The interface, not a registry: Bubble Tea copies components on every update,
// so an address recorded once names a copy that no longer exists. A value that
// answers for itself is always current, and the compiler checks the wiring.
func termwrightDeclaredSemantics(value reflect.Value) (annotate.Semantics, bool) {
	if provider, ok := value.Interface().(annotate.Provider); ok {
		return provider.TermwrightSemantics(), true
	}
	if value.CanAddr() {
		if provider, ok := value.Addr().Interface().(annotate.Provider); ok {
			return provider.TermwrightSemantics(), true
		}
	}
	return annotate.Semantics{}, false
}

// termwrightApplyAnnotation merges what the application declared.
//
// Only what the probe cannot observe. There is no field here for geometry or
// focus, and that is the guarantee rather than an omission.
func termwrightApplyAnnotation(meta annotate.Semantics, node *protocol.Node) {
	if meta.Role != "" {
		// Dropped when outside the closed set: a typo in an annotation is the
		// author's to fix, and exhaustive switches downstream depend on that
		// set staying closed.
		if role := protocol.Role(meta.Role); protocol.ValidRole(role) {
			node.Role = role
			termwrightProvenance(node, "role", protocol.ProvenanceAnnotation)
		}
	}
	if meta.Name != "" {
		node.Name = meta.Name
		termwrightProvenance(node, "name", protocol.ProvenanceAnnotation)
	}
	if meta.TestID != "" {
		node.TestID = meta.TestID
		termwrightProvenance(node, "testId", protocol.ProvenanceAnnotation)
	}
	if meta.Description != "" {
		node.Description = meta.Description
		termwrightProvenance(node, "description", protocol.ProvenanceAnnotation)
	}
	if len(meta.Domain) > 0 {
		node.Extended = make(map[string]any, len(meta.Domain))
		for key, value := range meta.Domain {
			node.Extended[key] = value
		}
		termwrightProvenance(node, "extended", protocol.ProvenanceAnnotation)
	}
	seenActions := make(map[protocol.Action]struct{}, len(meta.Actions))
	for _, action := range meta.Actions {
		if !protocol.ValidAction(action) {
			continue
		}
		if _, duplicate := seenActions[action]; duplicate {
			continue
		}
		seenActions[action] = struct{}{}
		node.Actions = append(node.Actions, action)
	}
	if len(node.Actions) > 0 {
		termwrightProvenance(node, "actions", protocol.ProvenanceAnnotation)
	}
}

func termwrightProvenance(node *protocol.Node, field, source string) {
	if node.PX == nil {
		node.PX = make(map[string]string)
	}
	node.PX[field] = source
}

// termwrightLibraryState reads the accessors the Bubbles patch set adds.
//
// Found by name through reflection rather than by importing Bubbles, which
// keeps the two patch sets independent: an application built with an
// unpatched Bubbles simply reports less, instead of failing to compile.
//
// These are the facts the audit found valuable and Bubbles keeps private: a
// spinner is otherwise just a glyph, `Percent()` reports the animation's
// target rather than what is drawn, and a file picker's highlighted entry has
// no index anywhere in its public surface.
func termwrightLibraryState(value reflect.Value, component string, node *protocol.Node) {
	switch component {
	case "spinner":
		if frame, ok := termwrightCallInt(value, "TermwrightFrame"); ok {
			node.State = termwrightWithPosition(node.State, frame, termwrightCallIntOr(value, "TermwrightFrameCount", 0))
		}
	case "progress":
		// The drawn fraction, not the one being animated towards.
		if shown, ok := termwrightCallFloat(value, "TermwrightShownPercent"); ok {
			text := strconv.FormatFloat(shown, 'f', 3, 64)
			node.Value = termwrightSensitiveValue(&text)
		}
	case "filepicker":
		if index, ok := termwrightCallInt(value, "TermwrightSelectedIndex"); ok && index >= 0 {
			node.State = termwrightWithPosition(node.State, index, termwrightCallIntOr(value, "TermwrightEntryCount", 0))
			if name := termwrightCallString(value, "TermwrightSelectedName"); name != nil && *name != "" {
				node.Value = termwrightSensitiveValue(name)
			}
		}
	case "list":
		if message := termwrightCallString(value, "TermwrightStatusMessage"); message != nil && *message != "" {
			node.Description = *message
		}
	case "table":
		if count, ok := termwrightCallInt(value, "TermwrightRowCount"); ok {
			node.State = termwrightWithSetSize(node.State, count)
		}
	}
}

func termwrightWithPosition(state *protocol.State, index, count int) *protocol.State {
	if state == nil {
		state = &protocol.State{}
	}
	state.PositionInSet = protocol.Int(index + 1)
	if count > 0 {
		state.SetSize = protocol.Int(count)
	}
	return state
}

func termwrightWithSetSize(state *protocol.State, count int) *protocol.State {
	if state == nil {
		state = &protocol.State{}
	}
	state.SetSize = protocol.Int(count)
	return state
}

func termwrightCallInt(value reflect.Value, name string) (int, bool) {
	method := value.MethodByName(name)
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return 0, false
	}
	if !method.Type().Out(0).ConvertibleTo(reflect.TypeOf(0)) {
		return 0, false
	}
	return int(method.Call(nil)[0].Int()), true
}

func termwrightCallIntOr(value reflect.Value, name string, fallback int) int {
	if result, ok := termwrightCallInt(value, name); ok {
		return result
	}
	return fallback
}

func termwrightCallFloat(value reflect.Value, name string) (float64, bool) {
	method := value.MethodByName(name)
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return 0, false
	}
	if method.Type().Out(0).Kind() != reflect.Float64 {
		return 0, false
	}
	return method.Call(nil)[0].Float(), true
}

// termwrightCallString invokes a no-argument getter returning a string.
//
// Public getters are the only way in: Bubbles is a different module, so its
// unexported fields are unreachable from here even though this file is
// compiled into the framework.
func termwrightCallString(value reflect.Value, name string) *string {
	method := value.MethodByName(name)
	if !method.IsValid() {
		// Try the pointer receiver, which is where half of Bubbles puts them.
		if value.CanAddr() {
			method = value.Addr().MethodByName(name)
		}
	}
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return nil
	}
	if method.Type().Out(0).Kind() != reflect.String {
		return nil
	}
	result := method.Call(nil)[0].String()
	return &result
}

// termwrightViewport reads the terminal size v1 knows about.
//
// The standard renderer learns it from the resize handler; a program using a
// different renderer reports nothing, and nothing is the right answer there
// rather than a guess.
func termwrightViewport(program *Program) (int, int) {
	if program == nil {
		return 0, 0
	}
	renderer, ok := program.renderer.(*standardRenderer)
	if !ok || renderer == nil {
		return 0, 0
	}
	renderer.mtx.Lock()
	defer renderer.mtx.Unlock()
	return renderer.width, renderer.height
}

// termwrightEchoesPlainly reports whether the widget draws what it holds.
//
// `EchoMode` is an exported field on textinput, and anything other than
// EchoNormal means the user deliberately hid the contents.
func termwrightEchoesPlainly(value reflect.Value) bool {
	field := value.FieldByName("EchoMode")
	if !field.IsValid() || !field.CanInt() {
		// No echo mode at all — textarea, for instance — so nothing is hidden.
		return true
	}
	return field.Int() == 0 // EchoNormal
}

func termwrightSensitiveValue(value *string) *protocol.SemanticValueObservation {
	if value == nil {
		return nil
	}
	return &protocol.SemanticValueObservation{
		Status: "known", Value: value, Sensitivity: "sensitive", Evidence: termwrightEvidence("instrumented"),
	}
}

func termwrightFocusState(value reflect.Value) *protocol.State {
	method := value.MethodByName("Focused")
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return nil
	}
	if method.Type().Out(0).Kind() != reflect.Bool {
		return nil
	}
	if !method.Call(nil)[0].Bool() {
		return nil
	}
	return &protocol.State{Focused: protocol.Bool(true)}
}

func (p *termwrightProbeState) identity(key string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if id, ok := p.ids[key]; ok {
		return id
	}
	p.nextID++
	id := "n" + strconv.Itoa(p.nextID)
	p.ids[key] = id
	return id
}

func termwrightTypeName(value any) string {
	kind := reflect.TypeOf(value)
	if kind == nil {
		return "nil"
	}
	for kind.Kind() == reflect.Pointer {
		kind = kind.Elem()
	}
	return kind.Name()
}

// termwrightRenderAndObserve renders the frame and then reports it.
//
// It exists so each of the three patch hunks is one line. A smaller hunk has
// fewer lines of context to drift on the next upstream bump, which is the only
// lever available when the anchor count is fixed by the framework's shape.
func termwrightRenderAndObserve(p *Program, model Model) {
	view := model.View()
	p.renderer.write(view) // send view to renderer
	termwrightAfterView(p, model, view)
}
