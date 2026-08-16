package tea

// Build-time instrumentation injected by termwright into a private copy of
// Bubble Tea v2. Upstream never sees this file.
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

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

const (
	probeName    = "termwright-probe-charm"
	probeVersion = "0.1.0"
)

type termwrightProbeState struct {
	client *protocol.Client

	mu      sync.Mutex
	ids     map[string]string
	nextID  int
	frames  atomic.Uint64
	dropped atomic.Uint64
}

var termwrightProbe = newTermwrightProbe()

func newTermwrightProbe() *termwrightProbeState {
	client := protocol.FromEnv(protocol.Options{
		AdapterName:    probeName,
		AdapterVersion: probeVersion,
		// The publish happens on the event-loop goroutine, between Update and
		// the renderer. An unbounded write would stall the loop whenever the
		// driver stops reading.
		WriteTimeout: protocol.DefaultWriteTimeout,
	})
	if client == nil {
		return nil
	}
	p := &termwrightProbeState{client: client, ids: make(map[string]string)}
	go func() { _ = client.Start(protocol.DialTimeout) }()
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
	p := termwrightProbe
	if p == nil || !p.client.Connected() {
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

	snapshot := p.snapshot(model, view, columns, rows)
	marker, err := p.client.Publish(snapshot)
	if err != nil || marker == "" {
		p.dropped.Add(1)
		// A dropped frame means this probe lost part of its own fact stream,
		// so the next publication owes the driver a whole tree.
		p.client.RequireFullSnapshot()
		return
	}
	_, _ = os.Stdout.WriteString(marker)
	p.frames.Add(1)
}

// snapshot reflects over the user's model and reports what it recognises.
func (p *termwrightProbeState) snapshot(model Model, view string, columns, rows int) *protocol.Snapshot {
	snapshot := &protocol.Snapshot{Columns: columns, Rows: rows}

	rootID := p.identity("root")
	snapshot.RootIDs = append(snapshot.RootIDs, rootID)
	snapshot.Nodes = append(snapshot.Nodes, protocol.Node{
		ID:            rootID,
		Role:          protocol.RoleApplication,
		Name:          termwrightTypeName(model),
		FrameworkType: termwrightTypeName(model),
	})

	p.walk(reflect.ValueOf(model), rootID, "", snapshot, 0)
	return snapshot
}

// walk descends the user's model looking for components it knows.
//
// Depth-bounded because a user's model is arbitrary: a cyclic or deeply nested
// structure must cost a truncated tree, never the frame.
func (p *termwrightProbeState) walk(
	value reflect.Value,
	parentID string,
	fieldName string,
	snapshot *protocol.Snapshot,
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

	if component := termwrightRecognise(value, fieldName); component != nil {
		id := p.identity(parentID + "/" + fieldName + "/" + component.frameworkType)
		component.node.ID = id
		component.node.ParentID = parentID
		snapshot.Nodes = append(snapshot.Nodes, component.node)
		// A recognised component's own fields are its business; descending
		// into it would report its internals as siblings of the application's.
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
		p.walk(value.Field(index), parentID, field.Name, snapshot, depth+1)
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
			node.Value = termwrightCallString(value, "Value")
		} else {
			node.State = termwrightWithReadonlySecret(node.State)
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
	return &recognised{frameworkType: component, node: node}
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

// termwrightWithReadonlySecret marks a field whose contents were withheld, so
// a reader can tell "empty" from "not published on purpose".
func termwrightWithReadonlySecret(state *protocol.State) *protocol.State {
	if state == nil {
		state = &protocol.State{}
	}
	state.ReadOnly = protocol.Bool(true)
	return state
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
