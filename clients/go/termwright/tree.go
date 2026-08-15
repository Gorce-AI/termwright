package termwright

import (
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

	node := protocol.Node{
		ID:       id,
		ParentID: parentID,
		Role:     role,
		Name:     name,
		Bounds:   boundsOf(primitive, columns, rows),
		State:    stateOf(primitive, focused, hidden),
		Actions:  actionsFor(role),
		Value:    valueOf(primitive),
	}
	if parentID == "" {
		snapshot.RootIDs = append(snapshot.RootIDs, id)
	}
	snapshot.Nodes = append(snapshot.Nodes, node)

	for _, child := range children {
		s.walk(child, id, snapshot, columns, rows, hidden)
	}
	s.appendSynthetic(primitive, id, snapshot)
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

// valueOf reports the current value of a value-bearing widget.
func valueOf(primitive tview.Primitive) string {
	switch widget := primitive.(type) {
	case *tview.InputField:
		return widget.GetText()
	case *tview.TextArea:
		return trimText(widget.GetText())
	case *tview.DropDown:
		_, option := widget.GetCurrentOption()
		return option
	}
	return ""
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
func anyHasFocus(children []tview.Primitive) bool {
	for _, child := range children {
		if child != nil && child.HasFocus() {
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

// childrenOf walks the containers tview exposes accessors for. Grid has no
// item accessor, so its children are reachable only through WithChildren.
func (s *Session) childrenOf(primitive tview.Primitive) []tview.Primitive {
	if s.config.children != nil {
		if children := s.config.children(primitive); children != nil {
			return children
		}
	}

	switch container := primitive.(type) {
	case *tview.Flex:
		children := make([]tview.Primitive, 0, container.GetItemCount())
		for index := 0; index < container.GetItemCount(); index++ {
			children = append(children, container.GetItem(index))
		}
		return children
	case *tview.Pages:
		names := container.GetPageNames(false)
		children := make([]tview.Primitive, 0, len(names))
		for _, name := range names {
			if page := container.GetPage(name); page != nil {
				children = append(children, page)
			}
		}
		return children
	case *tview.Form:
		children := make([]tview.Primitive, 0, container.GetFormItemCount()+container.GetButtonCount())
		for index := 0; index < container.GetFormItemCount(); index++ {
			children = append(children, container.GetFormItem(index))
		}
		for index := 0; index < container.GetButtonCount(); index++ {
			children = append(children, container.GetButton(index))
		}
		return children
	case *tview.Frame:
		if inner := container.GetPrimitive(); inner != nil {
			return []tview.Primitive{inner}
		}
	}
	return nil
}

// appendSynthetic emits nodes for items that are not primitives of their own —
// list entries and dropdown options — so they are addressable by role and name.
// They carry no bounds, which the schema allows.
func (s *Session) appendSynthetic(primitive tview.Primitive, parentID string, snapshot *protocol.Snapshot) {
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
