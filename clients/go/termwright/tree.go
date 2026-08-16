package termwright

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// maxTextName bounds the accessible name taken from a free-text widget, so a
// scrolling log cannot inflate every snapshot.
const maxTextName = 200

// buildSnapshot reads the primitive tree into a snapshot. It only reads: no
// primitive is drawn, focused or resized by this walk.
func (s *Session) buildSnapshot(columns, rows int) *protocol.Snapshot {
	snapshot := protocol.NewSnapshot("", 0, columns, rows)
	s.walk(s.root, "", snapshot, columns, rows, false)
	return snapshot
}

func (s *Session) walk(
	primitive tview.Primitive,
	parentID string,
	snapshot *protocol.Snapshot,
	columns, rows int,
	hidden bool,
) {
	if primitive == nil {
		return
	}

	id := s.idFor(primitive)
	role, name := s.describe(primitive)
	children := s.childrenOf(primitive)

	// HasFocus is true for ancestors of the focused primitive as well, so the
	// focus flag belongs to the deepest primitive that reports it. Asking the
	// application instead would deadlock: this runs inside tview's draw lock.
	focused := primitive.HasFocus() && !anyHasFocus(children)
	if hidden {
		// Nothing off-screen holds the focus, whatever the primitive believes.
		focused = false
	}

	node := protocol.Node{
		ID:            id,
		ParentID:      parentID,
		Role:          role,
		Name:          name,
		Bounds:        boundsOf(primitive, columns, rows),
		State:         stateOf(primitive, focused, hidden),
		Actions:       actionsFor(role),
		Value:         valueOf(primitive),
		TestID:        s.testIDFor(primitive),
		FrameworkType: frameworkTypeFor(primitive, role),
	}
	if parentID == "" {
		snapshot.RootIDs = append(snapshot.RootIDs, id)
	}
	snapshot.Nodes = append(snapshot.Nodes, node)

	for _, child := range children {
		// Hiding is inherited: everything under an unshown page is unshown.
		s.walk(child.primitive, id, snapshot, columns, rows, hidden || child.hidden)
	}
	s.appendSynthetic(primitive, id, snapshot, hidden)
}

// idFor assigns a stable id per primitive, so a node keeps its identity across
// revisions and the driver can follow it.
func (s *Session) idFor(primitive tview.Primitive) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.ids[primitive]; ok {
		return id
	}
	s.nextID++
	id := "p" + strconv.Itoa(s.nextID)
	s.ids[primitive] = id
	return id
}

// -- roles and names -------------------------------------------------------

func (s *Session) describe(primitive tview.Primitive) (protocol.Role, string) {
	if s.config.describe != nil {
		if role, name, ok := s.config.describe(primitive); ok {
			return role, name
		}
	}
	return roleOf(primitive), nameOf(primitive)
}

// roleOf maps a tview type onto a v1 semantic role.
func roleOf(primitive tview.Primitive) protocol.Role {
	switch primitive.(type) {
	case *tview.Button:
		return protocol.RoleButton
	case *tview.Checkbox:
		return protocol.RoleCheckbox
	case *tview.InputField, *tview.TextArea:
		return protocol.RoleTextbox
	case *tview.DropDown, *tview.List, *tview.TreeView:
		return protocol.RoleList
	case *tview.Table:
		return protocol.RoleTable
	case *tview.TextView:
		return protocol.RoleText
	case *tview.Modal:
		return protocol.RoleDialog
	case *tview.Form, *tview.Flex, *tview.Grid, *tview.Pages, *tview.Frame:
		return protocol.RoleRegion
	case *tview.Box:
		return protocol.RoleRegion
	}
	return protocol.RoleGeneric
}

// nameOf derives the accessible name: an explicit label wins, then the box
// title, then the widget's own text.
func nameOf(primitive tview.Primitive) string {
	switch widget := primitive.(type) {
	case *tview.Button:
		return widget.GetLabel()
	case *tview.Checkbox:
		return firstNonEmpty(widget.GetLabel(), widget.GetTitle())
	case *tview.InputField:
		return firstNonEmpty(widget.GetLabel(), widget.GetTitle())
	case *tview.DropDown:
		return firstNonEmpty(widget.GetLabel(), widget.GetTitle())
	case *tview.TextArea:
		return firstNonEmpty(widget.GetLabel(), widget.GetTitle())
	case *tview.TextView:
		return firstNonEmpty(widget.GetTitle(), trimText(widget.GetText(true)))
	case *tview.Box:
		return widget.GetTitle()
	}
	if boxed, ok := primitive.(interface{ GetTitle() string }); ok {
		return boxed.GetTitle()
	}
	return ""
}

// valueOf reports what a value-bearing widget contains, including the empty
// string — an empty field has a value of "", not no value. A nil result means
// the widget is not value-bearing at all.
func valueOf(primitive tview.Primitive) *string {
	switch widget := primitive.(type) {
	case *tview.InputField:
		return protocol.Text(widget.GetText())
	case *tview.TextArea:
		return protocol.Text(trimText(widget.GetText()))
	case *tview.DropDown:
		_, option := widget.GetCurrentOption()
		return protocol.Text(option)
	}
	return nil
}

func trimText(text string) string {
	text = strings.TrimSpace(text)
	if len(text) > maxTextName {
		return text[:maxTextName]
	}
	return text
}

func firstNonEmpty(candidates ...string) string {
	for _, candidate := range candidates {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// -- geometry and state ----------------------------------------------------

// boundsOf returns absolute viewport bounds, or nil when the primitive is not
// on screen. tview's GetRect is already absolute, so no parent offset applies.
func boundsOf(primitive tview.Primitive, columns, rows int) *protocol.Rect {
	x, y, width, height := primitive.GetRect()
	if width <= 0 || height <= 0 {
		return nil
	}
	if x >= columns || y >= rows || x+width <= 0 || y+height <= 0 {
		return nil
	}
	return &protocol.Rect{Row: y, Column: x, Width: width, Height: height}
}

// anyHasFocus reports whether the focus lives below this level.
func anyHasFocus(children []child) bool {
	for _, entry := range children {
		if entry.primitive != nil && entry.primitive.HasFocus() {
			return true
		}
	}
	return false
}

func stateOf(primitive tview.Primitive, focused bool, hidden bool) *protocol.State {
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
	switch widget := primitive.(type) {
	case *tview.Button:
		if widget.IsDisabled() {
			state.Disabled = protocol.Bool(true)
			empty = false
		}
	case *tview.Checkbox:
		state.Checked = widget.IsChecked()
		empty = false
	case *tview.Modal:
		state.Modal = protocol.Bool(true)
		empty = false
	case *tview.List:
		state.SetSize = protocol.Int(widget.GetItemCount())
		empty = false
	case *tview.Table:
		state.SetSize = protocol.Int(widget.GetRowCount())
		empty = false
	}
	if empty {
		return nil
	}
	return &state
}

func actionsFor(role protocol.Role) []protocol.Action {
	switch role {
	case protocol.RoleButton, protocol.RoleMenuItem, protocol.RoleTab:
		return []protocol.Action{protocol.ActionFocus, protocol.ActionActivate}
	case protocol.RoleCheckbox, protocol.RoleRadio:
		return []protocol.Action{protocol.ActionFocus, protocol.ActionToggle}
	case protocol.RoleTextbox:
		return []protocol.Action{protocol.ActionFocus, protocol.ActionSetValue}
	case protocol.RoleList, protocol.RoleTable:
		return []protocol.Action{protocol.ActionFocus, protocol.ActionScroll, protocol.ActionSelect}
	case protocol.RoleListItem:
		return []protocol.Action{protocol.ActionSelect, protocol.ActionActivate}
	}
	return nil
}

// -- child enumeration -----------------------------------------------------

// child is one enumerated child and whether its container is showing it.
type child struct {
	primitive tview.Primitive
	hidden    bool
}

func visible(primitives ...tview.Primitive) []child {
	children := make([]child, 0, len(primitives))
	for _, primitive := range primitives {
		if primitive != nil {
			children = append(children, child{primitive: primitive})
		}
	}
	return children
}

// childrenOf walks the containers tview exposes accessors for. Grid has no
// item accessor, so its children are reachable only through WithChildren.
//
// Pages is the one container that keeps children it is not showing, and those
// have to be published as hidden: a test asserting "the settings screen is
// open" must not pass while that page is still stacked out of sight.
func (s *Session) childrenOf(primitive tview.Primitive) []child {
	if s.config.children != nil {
		if supplied := s.config.children(primitive); supplied != nil {
			// A caller-supplied list says what exists, not what is shown; the
			// container's own state still decides visibility.
			return visible(supplied...)
		}
	}

	switch container := primitive.(type) {
	case *tview.Flex:
		primitives := make([]tview.Primitive, 0, container.GetItemCount())
		for index := 0; index < container.GetItemCount(); index++ {
			primitives = append(primitives, container.GetItem(index))
		}
		return visible(primitives...)
	case *tview.Pages:
		shown := make(map[string]struct{})
		for _, name := range container.GetPageNames(true) {
			shown[name] = struct{}{}
		}
		names := container.GetPageNames(false)
		children := make([]child, 0, len(names))
		for _, name := range names {
			page := container.GetPage(name)
			if page == nil {
				continue
			}
			_, isShown := shown[name]
			children = append(children, child{primitive: page, hidden: !isShown})
		}
		return children
	case *tview.Form:
		primitives := make([]tview.Primitive, 0, container.GetFormItemCount()+container.GetButtonCount())
		for index := 0; index < container.GetFormItemCount(); index++ {
			primitives = append(primitives, container.GetFormItem(index))
		}
		for index := 0; index < container.GetButtonCount(); index++ {
			primitives = append(primitives, container.GetButton(index))
		}
		return visible(primitives...)
	case *tview.Frame:
		if inner := container.GetPrimitive(); inner != nil {
			return visible(inner)
		}
	}
	return nil
}

// appendSynthetic emits nodes for items that are not primitives of their own —
// list entries and dropdown options — so they are addressable by role and name.
// They carry no bounds, which the schema allows.
func (s *Session) appendSynthetic(primitive tview.Primitive, parentID string, snapshot *protocol.Snapshot, hidden bool) {
	hiddenFlag := func() *bool {
		if hidden {
			return protocol.Bool(true)
		}
		return nil
	}
	switch widget := primitive.(type) {
	case *tview.List:
		current := widget.GetCurrentItem()
		for index := 0; index < widget.GetItemCount(); index++ {
			main, secondary := widget.GetItemText(index)
			node := protocol.Node{
				ID:       parentID + ":item" + strconv.Itoa(index),
				ParentID: parentID,
				Role:     protocol.RoleListItem,
				Name:     firstNonEmpty(main, secondary),
				Actions:  actionsFor(protocol.RoleListItem),
				State: &protocol.State{
					Selected:      protocol.Bool(index == current),
					PositionInSet: protocol.Int(index + 1),
					SetSize:       protocol.Int(widget.GetItemCount()),
					Hidden:        hiddenFlag(),
				},
			}
			snapshot.Nodes = append(snapshot.Nodes, node)
		}
	case *tview.DropDown:
		current, _ := widget.GetCurrentOption()
		for index := 0; index < widget.GetOptionCount(); index++ {
			snapshot.Nodes = append(snapshot.Nodes, protocol.Node{
				ID:       parentID + ":option" + strconv.Itoa(index),
				ParentID: parentID,
				Role:     protocol.RoleListItem,
				Name:     optionText(widget, index),
				Actions:  actionsFor(protocol.RoleListItem),
				State: &protocol.State{
					Selected:      protocol.Bool(index == current),
					PositionInSet: protocol.Int(index + 1),
					SetSize:       protocol.Int(widget.GetOptionCount()),
					Hidden:        hiddenFlag(),
				},
			})
		}
	}
}

// optionText reads one dropdown option without disturbing the selection.
func optionText(widget *tview.DropDown, index int) string {
	current, currentText := widget.GetCurrentOption()
	if index == current {
		return currentText
	}
	// tview exposes no per-index accessor, so options other than the current
	// one are published positionally.
	return "option " + strconv.Itoa(index+1)
}

// frameworkTypeFor names the widget's own Go type, which the protocol requires
// whenever the role is generic: an unrecognised widget must at least say what
// tview (or the application) called it. `%T` yields e.g. "*tview.Box" or the
// application's own "*main.Sparkline", which is exactly the distinguishing
// information a reader of an unknown node needs.
func frameworkTypeFor(primitive tview.Primitive, role protocol.Role) string {
	if role != protocol.RoleGeneric {
		return ""
	}
	return fmt.Sprintf("%T", primitive)
}
