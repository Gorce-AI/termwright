package protocol

// Rect is a zero-based viewport cell rectangle.
type Rect struct {
	Row    int `json:"row"`
	Column int `json:"column"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// State is the closed state set. Pointers distinguish "unset" from "false":
// an omitted state is not an assertion, a false one is.
type State struct {
	Disabled      *bool   `json:"disabled,omitempty"`
	Focused       *bool   `json:"focused,omitempty"`
	Selected      *bool   `json:"selected,omitempty"`
	Checked       any     `json:"checked,omitempty"` // bool or the string "mixed"
	Expanded      *bool   `json:"expanded,omitempty"`
	Modal         *bool   `json:"modal,omitempty"`
	Busy          *bool   `json:"busy,omitempty"`
	Hidden        *bool   `json:"hidden,omitempty"`
	ReadOnly      *bool   `json:"readonly,omitempty"`
	Multiline     *bool   `json:"multiline,omitempty"`
	Orientation   string  `json:"orientation,omitempty"`
	Level         *int    `json:"level,omitempty"`
	PositionInSet *int    `json:"positionInSet,omitempty"`
	SetSize       *int    `json:"setSize,omitempty"`
	ScrollOffset  *int    `json:"scrollOffset,omitempty"`
	ScrollExtent  *int    `json:"scrollExtent,omitempty"`
}

// TextRange maps grapheme offsets of a node's text onto cell coordinates.
type TextRange struct {
	StartOffset int  `json:"startOffset"`
	EndOffset   int  `json:"endOffset"`
	Rect        Rect `json:"rect"`
}

// Node is one accessible element. Bounds, when present, are absolute viewport
// cells — never parent-relative.
type Node struct {
	ID          string      `json:"id"`
	ParentID    string      `json:"parentId,omitempty"`
	Role        Role        `json:"role"`
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Value       string      `json:"value,omitempty"`
	Bounds      *Rect       `json:"bounds,omitempty"`
	State       *State      `json:"state,omitempty"`
	Actions     []Action    `json:"actions,omitempty"`
	LabelledBy  []string    `json:"labelledBy,omitempty"`
	DescribedBy []string    `json:"describedBy,omitempty"`
	TextRanges  []TextRange `json:"textRanges,omitempty"`
	TestID      string      `json:"testId,omitempty"`
}

// Cursor is the terminal cursor position in viewport cells.
type Cursor struct {
	Row     int    `json:"row"`
	Column  int    `json:"column"`
	Visible bool   `json:"visible"`
	Shape   string `json:"shape,omitempty"`
}

// Snapshot is the whole tree for one committed render.
type Snapshot struct {
	V         int      `json:"v"`
	SessionID string   `json:"sessionId"`
	Revision  int64    `json:"revision"`
	Columns   int      `json:"columns"`
	Rows      int      `json:"rows"`
	Cursor    *Cursor  `json:"cursor,omitempty"`
	RootIDs   []string `json:"rootIds"`
	Nodes     []Node   `json:"nodes"`
}

// NewSnapshot returns a snapshot with v set and non-nil slices, so it marshals
// as [] rather than null.
func NewSnapshot(sessionID string, revision int64, columns, rows int) *Snapshot {
	return &Snapshot{
		V:         1,
		SessionID: sessionID,
		Revision:  revision,
		Columns:   columns,
		Rows:      rows,
		RootIDs:   []string{},
		Nodes:     []Node{},
	}
}

// Bool returns a pointer to v, for the optional State fields.
func Bool(v bool) *bool { return &v }

// Int returns a pointer to v, for the optional State fields.
func Int(v int) *int { return &v }
