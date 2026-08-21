package tview

// Build-time instrumentation injected by termwright into a private copy of
// tview. Upstream never sees this file; it exists only in the copy a
// termwright-driven build compiles against.
//
// Being inside the package is the whole point: the semantic state a test wants
// — a button's label, a list's selection, a page's visibility — lives in
// unexported fields that no external adapter can read without reflection.
// Grid is the clearest case: its `items` field has no accessor at all, so the
// out-of-package adapter has to be handed a callback, and here it is a field
// read.
//
// Three rules from the Phase 0 audit (docs/architecture/audit/tview.md §1–2)
// are load-bearing, and breaking any of them turns a working application into
// a hang or a lie:
//
//  1. The hook runs inside Application.draw(), which holds the application's
//     write lock for the whole frame. Anything that waits on the event loop —
//     QueueUpdate, QueueUpdateDraw, Draw, SetFocus, Stop — deadlocks, because
//     the loop is the goroutine currently inside draw().
//  2. Reading primitive state is safe from here and essentially nowhere else:
//     rects are assigned by parents *during* the draw, so another goroutine
//     reading GetRect races the layout.
//  3. The marker must follow the frame's bytes. The hook sits after
//     screen.Show(), which is why publication is synchronous here rather than
//     handed to a goroutine: a marker written later could land after the next
//     frame's bytes and pair the tree with the wrong screen.

import (
	"errors"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gdamore/tcell/v2"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/evidence"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// probeName and probeVersion identify this probe in the handshake, distinctly
// from the hand-written adapter so a session can be told apart in diagnostics.
const (
	probeName        = "termwright-probe-tview"
	probeVersion     = "0.2.0"
	frameworkVersion = "v0.42.0"
)

// termwrightProbeState is nil for an uninstrumented run, which is every run
// that does not carry the handshake variables.
type termwrightProbeState struct {
	client *protocol.Client
	start  sync.Once

	mu            sync.Mutex
	ids           map[Primitive]string
	nextID        int
	dropped       atomic.Uint64
	timedOut      atomic.Uint64
	frames        atomic.Uint64
	redrawPending atomic.Bool
}

// TermwrightProbeStats reports what the probe did and failed to do.
//
// Exported because the conformance fixture asserts on it: a drop counter no
// test can read is a drop counter nobody notices.
type TermwrightProbeStats struct {
	Frames   uint64
	Dropped  uint64
	TimedOut uint64
}

// TermwrightProbeStatistics returns the counters, or zeroes when dormant.
func TermwrightProbeStatistics() TermwrightProbeStats {
	p := termwrightProbe
	if p == nil {
		return TermwrightProbeStats{}
	}
	return TermwrightProbeStats{
		Frames:   p.frames.Load(),
		Dropped:  p.dropped.Load(),
		TimedOut: p.timedOut.Load(),
	}
}

var termwrightProbe = newTermwrightProbe()

// newTermwrightProbe honours the dormant rule: without an endpoint and a token
// the copy behaves exactly like upstream. `FromEnv` returns nil in that case,
// so there is one branch and no second source of truth about what "dormant"
// means.
func newTermwrightProbe() *termwrightProbeState {
	client := protocol.FromEnv(protocol.Options{
		AdapterName:    probeName,
		AdapterVersion: probeVersion,
		Probe: &protocol.ProbeInfo{
			Framework:        "tview",
			FrameworkVersion: frameworkVersion,
			ProbeVersion:     probeVersion,
			IdentityKind:     protocol.ProbeIdentityStable,
			Capabilities: []protocol.ProbeCapability{
				protocol.ProbeCapStableIdentity,
				protocol.ProbeCapAnnotations,
			},
		},
		Capabilities: []protocol.Capability{
			protocol.CapTree,
			protocol.CapStates,
			protocol.CapActions,
			protocol.CapRenderRevisions,
		},
		// Limit one frame write. The publish below happens under the
		// application's write lock, so an unbounded write would freeze
		// rendering whenever the driver stops reading — a frozen debugger, a
		// slow consumer, a transport torn down mid-frame. A quarter of a
		// second of not being read means the driver is not keeping up, and
		// the next frame carries newer state anyway.
		WriteTimeout: protocol.DefaultWriteTimeout,
		// Freeze the application's production evidence providers into the same
		// hello as the certified tview adapter. Providers only contribute facts;
		// all actions still enter through tcell's real terminal input path.
		EvidenceProviders: evidence.DefaultRegistry(),
	})
	if client == nil {
		return nil
	}
	// Do not freeze providers during package initialization: application main
	// has not had a chance to register its production router yet. The first
	// post-flush hook starts synchronously, then publishes that same frame.
	return &termwrightProbeState{client: client, ids: make(map[Primitive]string)}
}

func (p *termwrightProbeState) ensureStarted() bool {
	p.start.Do(func() { _ = p.client.Start(protocol.DialTimeout) })
	return p.client.Connected()
}

// termwrightAfterFrame is called from draw(), after screen.Show() has flushed
// the frame's bytes.
func termwrightAfterFrame(a *Application, screen tcell.Screen) {
	if p := termwrightProbe; p != nil {
		p.afterFrame(a, screen)
	}
}

// afterFrame is the method form, so a test can drive an instance of its own
// rather than the package-level probe a real run installs.
func (p *termwrightProbeState) afterFrame(a *Application, screen tcell.Screen) {
	if screen == nil || a == nil {
		return
	}
	if !p.ensureStarted() {
		p.redrawAfterHandshake(a)
		return
	}

	columns, rows := screen.Size()
	if columns <= 0 || rows <= 0 {
		return
	}

	snapshot, duplicateKey := p.snapshot(a, columns, rows)
	if duplicateKey != "" {
		_ = p.client.Fail("duplicate-semantic-key", "duplicate SemanticKey: "+string(duplicateKey))
		return
	}
	marker, err := p.client.Publish(snapshot)
	if err != nil || marker == "" {
		p.onPublishFailed(err)
		return
	}
	// After the bytes, which is the whole reason this call site exists.
	_, _ = os.Stdout.WriteString(marker)
	p.frames.Add(1)
}

// redrawAfterHandshake closes the startup race for applications whose first
// frame is also their last frame until input arrives. The initial draw must not
// block on the driver, so the handshake remains asynchronous; once connected,
// one queued draw publishes the current tree without requiring synthetic user
// input. QueueUpdateDraw is the framework's supported cross-goroutine path.
func (p *termwrightProbeState) redrawAfterHandshake(a *Application) {
	if !p.redrawPending.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer p.redrawPending.Store(false)
		deadline := time.Now().Add(2 * time.Second)
		for !p.client.Connected() && time.Now().Before(deadline) {
			time.Sleep(5 * time.Millisecond)
		}
		if p.client.Connected() {
			a.QueueUpdateDraw(func() {})
		}
	}()
}

// onPublishFailed records a frame the driver will never see.
//
// Two things have to happen together, and leaving out either one
// produces a worse failure than dropping the frame did:
//
//  1. **No marker.** A marker names a revision; writing one for a tree that
//     never arrived makes the driver wait for it and then report
//     revision-expired — a diagnosis pointing at the adapter's timing rather
//     than at the driver that stopped reading.
//  2. **Keep rendering.** The application is mid-frame under its own lock;
//     instrumentation failing is not the application failing.
func (p *termwrightProbeState) onPublishFailed(err error) {
	p.dropped.Add(1)

	if errors.Is(err, protocol.ErrWriteTimeout) {
		// The stream now holds part of a frame and has no resynchronisation
		// point, so the client closes the session. Nothing to retry: the next
		// Publish returns immediately and the application draws on.
		p.timedOut.Add(1)
	}
}

// identity returns a stable id for a primitive.
//
// The pointer is the identity: tview retains its widget tree across frames, so
// the same *Button is the same button, and that is what makes the IR's
// `stable` identity kind honest here rather than a fabricated ordinal.
func (p *termwrightProbeState) identity(primitive Primitive) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if id, ok := p.ids[primitive]; ok {
		return id
	}
	p.nextID++
	id := "n" + strconv.Itoa(p.nextID)
	p.ids[primitive] = id
	return id
}

// snapshot walks the retained tree into the wire form.
func (p *termwrightProbeState) snapshot(a *Application, columns, rows int) (*protocol.Snapshot, annotate.SemanticKey) {
	snapshot := protocol.NewSnapshot("", 0, columns, rows)
	snapshot.HitGrid = termwrightUnsupportedHitGrid()
	if a.root == nil {
		return snapshot, ""
	}
	keys := make(map[annotate.SemanticKey]string)
	duplicates := make(map[annotate.SemanticKey]struct{})
	pending := make([]termwrightRelations, 0)
	p.walk(a.root, "", false, columns, rows, snapshot, keys, duplicates, &pending)
	if len(duplicates) > 0 {
		ordered := make([]string, 0, len(duplicates))
		for key := range duplicates {
			ordered = append(ordered, string(key))
		}
		sort.Strings(ordered)
		return snapshot, annotate.SemanticKey(ordered[0])
	}
	maxRelations := protocol.DefaultLimits.MaxRelationTargets
	if p.client != nil {
		maxRelations = p.client.Limits().MaxRelationTargets
	}
	termwrightResolveRelations(snapshot, keys, duplicates, pending, maxRelations)
	return snapshot, ""
}

// termwrightRelations holds author references until every node has been
// visited. A label may be drawn after the control it labels, so resolving in
// walk order would make declaration order part of the API.
type termwrightRelations struct {
	nodeIndex   int
	labelledBy  []annotate.SemanticKey
	describedBy []annotate.SemanticKey
}

// walk appends one node and recurses.
//
// `hidden` is inherited: a widget on an unshown page is not merely unfocused,
// it is not on screen, and every descendant of it is in the same position.
func (p *termwrightProbeState) walk(
	primitive Primitive,
	parentID string,
	hidden bool,
	columns, rows int,
	snapshot *protocol.Snapshot,
	keys map[annotate.SemanticKey]string,
	duplicates map[annotate.SemanticKey]struct{},
	pending *[]termwrightRelations,
) {
	if primitive == nil {
		return
	}

	id := p.identity(primitive)
	children := termwrightChildren(primitive)

	// HasFocus reports true for ancestors of the focused primitive as well, so
	// the flag belongs to the deepest one that claims it.
	focused := !hidden && primitive.HasFocus() && !termwrightAnyFocus(children)

	role := termwrightRole(primitive)
	node := protocol.Node{
		ID:       id,
		ParentID: parentID,
		Role:     role,
		Name:     termwrightName(primitive),
		Value:    termwrightValue(primitive),
		State:    termwrightState(primitive, focused, hidden),
		P:        protocol.ProvenanceFramework,
		PX: map[string]string{
			"role": protocol.ProvenanceRecognizer,
		},
	}
	node.Geometry = termwrightGeometry(primitive, hidden)
	// Required for a generic node, and useful on every other one: it is what
	// keeps a widget this probe does not know about alive and identifiable
	// rather than flattened into an anonymous region.
	node.FrameworkType = termwrightTypeName(primitive)
	// An author's annotation is merged on top of the observed facts, and only
	// where the probe has nothing better: it may say what a widget *is*, never
	// where it is or whether it has the focus. Those the probe measured.
	meta, annotated := annotate.Lookup(primitive)
	if annotated {
		termwrightApplyAnnotation(meta, &node)
		termwrightRegisterKey(meta.Key, id, keys, duplicates)
	}
	if parentID == "" {
		snapshot.RootIDs = append(snapshot.RootIDs, id)
	}
	snapshot.Nodes = append(snapshot.Nodes, node)
	if annotated && (len(meta.LabelledBy) > 0 || len(meta.DescribedBy) > 0) {
		*pending = append(*pending, termwrightRelations{
			nodeIndex:   len(snapshot.Nodes) - 1,
			labelledBy:  meta.LabelledBy,
			describedBy: meta.DescribedBy,
		})
	}

	for _, child := range children {
		p.walk(child.primitive, id, hidden || child.hidden, columns, rows, snapshot, keys, duplicates, pending)
	}
	p.appendSynthetic(primitive, id, hidden, snapshot)
}

func termwrightRegisterKey(
	key annotate.SemanticKey,
	id string,
	keys map[annotate.SemanticKey]string,
	duplicates map[annotate.SemanticKey]struct{},
) {
	if key == "" {
		return
	}
	if _, duplicate := duplicates[key]; duplicate {
		return
	}
	if previous, exists := keys[key]; exists && previous != id {
		delete(keys, key)
		duplicates[key] = struct{}{}
		return
	}
	keys[key] = id
}

func termwrightResolveRelations(
	snapshot *protocol.Snapshot,
	keys map[annotate.SemanticKey]string,
	duplicates map[annotate.SemanticKey]struct{},
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
			if _, duplicate := duplicates[key]; duplicate {
				continue
			}
			id, found := keys[key]
			if !found {
				continue
			}
			if _, repeated := seen[id]; repeated {
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

func termwrightProvenance(node *protocol.Node, field, source string) {
	if node.PX == nil {
		node.PX = make(map[string]string)
	}
	node.PX[field] = source
}

// termwrightApplyAnnotation merges what the application declared.
//
// tview retains its widgets, so a registry keyed by the primitive's identity
// works here — which is why tview annotates by registration while Charm, whose
// components are copied values, annotates through an interface.
func termwrightApplyAnnotation(meta annotate.Semantics, node *protocol.Node) {
	if meta.Role != "" {
		// Validated against the closed set and dropped when unknown, rather
		// than guessed at: exhaustive switches downstream depend on that set
		// staying closed, and a typo in an annotation is the author's to fix.
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
	// Domain state has its own namespace, so it cannot pollute the closed
	// portable state vocabulary or masquerade as prose.
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

// termwrightChild is a child plus whether its container is showing it.
type termwrightChild struct {
	primitive Primitive
	hidden    bool
}

// termwrightChildren enumerates a container's children from inside the package.
func termwrightChildren(p Primitive) []termwrightChild {
	switch c := p.(type) {
	case *Flex:
		children := make([]termwrightChild, 0, len(c.items))
		for _, item := range c.items {
			if item.Item != nil {
				children = append(children, termwrightChild{primitive: item.Item})
			}
		}
		return children
	case *Grid:
		// The case an out-of-package adapter cannot serve at all. `visible`
		// carries the last draw's decision, which is exactly what a test means
		// by "is it on screen".
		children := make([]termwrightChild, 0, len(c.items))
		for _, item := range c.items {
			if item.Item != nil {
				children = append(children, termwrightChild{primitive: item.Item, hidden: !item.visible})
			}
		}
		return children
	case *Pages:
		children := make([]termwrightChild, 0, len(c.pages))
		for _, page := range c.pages {
			if page.Item != nil {
				children = append(children, termwrightChild{primitive: page.Item, hidden: !page.Visible})
			}
		}
		return children
	case *Frame:
		if c.primitive != nil {
			return []termwrightChild{{primitive: c.primitive}}
		}
	case *Form:
		children := make([]termwrightChild, 0, len(c.items)+len(c.buttons))
		for _, item := range c.items {
			children = append(children, termwrightChild{primitive: item})
		}
		for _, button := range c.buttons {
			children = append(children, termwrightChild{primitive: button})
		}
		return children
	case *Modal:
		if c.frame != nil {
			return []termwrightChild{{primitive: c.frame}}
		}
	}
	return nil
}

func termwrightAnyFocus(children []termwrightChild) bool {
	for _, child := range children {
		if child.primitive != nil && child.primitive.HasFocus() {
			return true
		}
	}
	return false
}

// termwrightRole maps a widget type to the closed role set.
//
// Deliberately identical to the hand-written adapter's mapping: the two must
// agree, or the same application would describe itself differently depending
// on how it was instrumented, and every conformance snapshot would fork.
func termwrightRole(p Primitive) protocol.Role {
	switch p.(type) {
	case *Button:
		return protocol.RoleButton
	case *Checkbox:
		return protocol.RoleCheckbox
	case *InputField, *TextArea:
		return protocol.RoleTextbox
	case *DropDown, *List, *TreeView:
		return protocol.RoleList
	case *Table:
		return protocol.RoleTable
	case *TextView:
		return protocol.RoleText
	case *Modal:
		return protocol.RoleDialog
	case *Form, *Flex, *Grid, *Pages, *Frame, *Box:
		return protocol.RoleRegion
	}
	// Never dropped: an unrecognised widget keeps its geometry, its children and
	// its own type name, which is what makes a new tview release degrade
	// rather than disappear.
	return protocol.RoleGeneric
}

// termwrightName derives the accessible name.
func termwrightName(p Primitive) string {
	switch widget := p.(type) {
	case *Button:
		return widget.GetLabel()
	case *Checkbox:
		return termwrightFirst(widget.GetLabel(), widget.GetTitle())
	case *InputField:
		return termwrightFirst(widget.GetLabel(), widget.GetTitle())
	case *DropDown:
		return termwrightFirst(widget.GetLabel(), widget.GetTitle())
	case *TextArea:
		return termwrightFirst(widget.GetLabel(), widget.GetTitle())
	case *TextView:
		return termwrightFirst(widget.GetTitle(), termwrightTrim(widget.GetText(true)))
	case *Modal:
		// Modal exposes no getter at all; the text is the only name it has.
		return termwrightTrim(widget.text)
	case *Box:
		return widget.GetTitle()
	}
	if boxed, ok := p.(interface{ GetTitle() string }); ok {
		return boxed.GetTitle()
	}
	return ""
}

// termwrightValue reports the current value of a value-bearing widget.
//
// A pointer because the empty string is a fact: `""` says the field is empty,
// absent says this widget carries no value at all. Collapsing the two would
// make an assertion on an emptied input box unwritable.
func termwrightValue(p Primitive) *string {
	switch widget := p.(type) {
	case *InputField:
		text := widget.GetText()
		return &text
	case *TextArea:
		text := widget.GetText()
		return &text
	case *DropDown:
		_, text := widget.GetCurrentOption()
		return &text
	}
	return nil
}

// termwrightTypeName is the framework's own name for the widget, without the
// package qualifier that would be identical on every node.
func termwrightTypeName(p Primitive) string {
	name := reflect.TypeOf(p).String()
	if index := strings.LastIndex(name, "."); index >= 0 {
		name = name[index+1:]
	}
	return name
}

// termwrightGeometry qualifies only facts the retained tview tree exposes.
// GetRect is the parent's intended allocation. The framework exposes no
// general nested clipping or paint ownership, so visibleRect and pointer hit
// testing remain unavailable.
func termwrightGeometry(p Primitive, hidden bool) protocol.NodeGeometryObservations {
	displayed := !hidden
	geometry := protocol.NodeGeometryObservations{
		Displayed: protocol.Observation[bool]{Status: "known", Value: &displayed, Evidence: termwrightEvidence("instrumented")},
	}
	if hidden {
		geometry.IntendedRect = protocol.Observation[protocol.Rect]{Status: "absent", Reason: "not-displayed", Evidence: termwrightEvidence("instrumented")}
		geometry.VisibleRect = protocol.Observation[protocol.Rect]{Status: "absent", Reason: "not-displayed", Evidence: termwrightEvidence("instrumented")}
		return geometry
	}

	x, y, width, height := p.GetRect()
	if width <= 0 || height <= 0 {
		geometry.IntendedRect = protocol.Observation[protocol.Rect]{Status: "absent", Reason: "not-laid-out", Evidence: termwrightEvidence("measured")}
		geometry.VisibleRect = protocol.Observation[protocol.Rect]{Status: "absent", Reason: "not-laid-out", Evidence: termwrightEvidence("measured")}
		return geometry
	}
	intended := protocol.Rect{Row: y, Column: x, Width: width, Height: height}
	geometry.IntendedRect = protocol.Observation[protocol.Rect]{Status: "known", Value: &intended, Evidence: termwrightEvidence("measured")}
	geometry.VisibleRect = protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapClippedGeometry), Reason: "framework-unobservable"}
	return geometry
}

func termwrightEvidence(method string) *protocol.EvidenceProvenance {
	return &protocol.EvidenceProvenance{
		Source: "framework", Method: method, Strength: "authoritative", ProviderID: probeName,
	}
}

func termwrightUnsupportedHitGrid() protocol.Observation[protocol.PointerHitGrid] {
	return protocol.Observation[protocol.PointerHitGrid]{
		Status: "unsupported", Capability: "pointer-hit-grid", Reason: "framework-unobservable",
	}
}

// termwrightScroll reports a scroll offset only when it is a fact.
//
// Several of these fields are meaningless until the widget has been drawn once
// (the audit lists them: TextView.pageSize, TreeView.nodes, Table.visibleRows
// and friends), and tview leaves some of them negative until then. A negative
// offset is not "scrolled backwards", it is "not decided yet" — publishing it
// asserts something false and, since the schema requires a non-negative
// integer, gets the whole snapshot refused.
func termwrightScroll(offset int) *int {
	if offset < 0 {
		return nil
	}
	return protocol.Int(offset)
}

// termwrightCount is the same guard for set sizes.
func termwrightCount(count int) *int {
	if count < 0 {
		return nil
	}
	return protocol.Int(count)
}

// termwrightState reads the observable state of one widget.
func termwrightState(p Primitive, focused, hidden bool) *protocol.State {
	state := protocol.State{}
	empty := true

	if focused {
		state.Focused = protocol.Bool(true)
		empty = false
	}
	if hidden {
		state.Hidden = protocol.Bool(true)
		empty = false
	}

	switch widget := p.(type) {
	case *Button:
		if widget.IsDisabled() {
			state.Disabled = protocol.Bool(true)
			empty = false
		}
	case *Checkbox:
		state.Checked = widget.IsChecked()
		if widget.disabled {
			state.Disabled = protocol.Bool(true)
		}
		empty = false
	case *DropDown:
		if widget.disabled {
			state.Disabled = protocol.Bool(true)
			empty = false
		}
		state.SetSize = termwrightCount(widget.GetOptionCount())
		state.Expanded = protocol.Bool(widget.IsOpen())
		empty = false
	case *TextArea:
		if widget.GetDisabled() {
			state.Disabled = protocol.Bool(true)
		}
		row, _ := widget.GetOffset()
		state.ScrollOffset = termwrightScroll(row)
		empty = false
	case *List:
		state.SetSize = termwrightCount(widget.GetItemCount())
		// Named `itemOffset` here and `lineOffset`, `rowOffset` or `offsetY`
		// on the other four scrollables; there is no single field to reach for.
		offset, _ := widget.GetOffset()
		state.ScrollOffset = termwrightScroll(offset)
		empty = false
	case *Table:
		state.SetSize = termwrightCount(widget.GetRowCount())
		row, _ := widget.GetOffset()
		state.ScrollOffset = termwrightScroll(row)
		empty = false
	case *TextView:
		row, _ := widget.GetScrollOffset()
		state.ScrollOffset = termwrightScroll(row)
		empty = false
	case *TreeView:
		state.ScrollOffset = termwrightScroll(widget.GetScrollOffset())
		state.SetSize = termwrightCount(widget.GetRowCount())
		empty = false
	case *Modal:
		state.Modal = protocol.Bool(true)
		empty = false
	}

	if empty {
		return nil
	}
	return &state
}

// appendSynthetic emits nodes for entries that are not primitives of their own
// — list items and dropdown options — so they are addressable by role and name.
// Their geometry observations stay explicitly unknown because entries are not
// primitives with framework-owned rectangles.
func (p *termwrightProbeState) appendSynthetic(
	primitive Primitive,
	parentID string,
	hidden bool,
	snapshot *protocol.Snapshot,
) {
	switch widget := primitive.(type) {
	case *List:
		current := widget.GetCurrentItem()
		count := widget.GetItemCount()
		for index := 0; index < count; index++ {
			main, secondary := widget.GetItemText(index)
			node := protocol.Node{
				ID:       parentID + ":item" + strconv.Itoa(index),
				ParentID: parentID,
				Role:     protocol.RoleListItem,
				Name:     termwrightFirst(main, secondary),
				State:    termwrightItemState(index == current, index, count, hidden),
				P:        protocol.ProvenanceFramework,
				PX: map[string]string{
					"role": protocol.ProvenanceRecognizer,
				},
			}
			termwrightSyntheticGeometry(&node)
			snapshot.Nodes = append(snapshot.Nodes, node)
		}
	case *DropDown:
		current, _ := widget.GetCurrentOption()
		count := widget.GetOptionCount()
		for index := 0; index < count; index++ {
			node := protocol.Node{
				ID:       parentID + ":option" + strconv.Itoa(index),
				ParentID: parentID,
				Role:     protocol.RoleListItem,
				Name:     widget.options[index].Text,
				State:    termwrightItemState(index == current, index, count, hidden),
				P:        protocol.ProvenanceFramework,
				PX: map[string]string{
					"role": protocol.ProvenanceRecognizer,
				},
			}
			termwrightSyntheticGeometry(&node)
			snapshot.Nodes = append(snapshot.Nodes, node)
		}
	}
}

func termwrightSyntheticGeometry(node *protocol.Node) {
	node.Geometry = protocol.NodeGeometryObservations{
		Displayed:    protocol.Observation[bool]{Status: "unsupported", Capability: "displayed", Reason: "framework-unobservable"},
		IntendedRect: protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapIntendedGeometry), Reason: "framework-unobservable"},
		VisibleRect:  protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapClippedGeometry), Reason: "framework-unobservable"},
	}
}

func termwrightItemState(selected bool, index, count int, hidden bool) *protocol.State {
	state := protocol.State{
		Selected:      protocol.Bool(selected),
		PositionInSet: protocol.Int(index + 1),
		SetSize:       protocol.Int(count),
	}
	if hidden {
		state.Hidden = protocol.Bool(true)
	}
	return &state
}

func termwrightFirst(candidates ...string) string {
	for _, candidate := range candidates {
		if trimmed := termwrightTrim(candidate); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// termwrightTrim collapses the padding widgets use for layout, so a name reads
// the way it looks rather than the way it was spaced.
func termwrightTrim(text string) string {
	start := 0
	end := len(text)
	for start < end && (text[start] == ' ' || text[start] == '\t' || text[start] == '\n' || text[start] == '\r') {
		start++
	}
	for end > start && (text[end-1] == ' ' || text[end-1] == '\t' || text[end-1] == '\n' || text[end-1] == '\r') {
		end--
	}
	return text[start:end]
}
