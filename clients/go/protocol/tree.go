package protocol

// Rect is a zero-based viewport cell rectangle.
type Rect struct {
	Row    int `json:"row"`
	Column int `json:"column"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Observation preserves whether a fact is known, absent, retryably unknown,
// or unsupported. Value is meaningful only when Status is "known".
type Observation[T any] struct {
	Status     string `json:"status"`
	Value      *T     `json:"value,omitempty"`
	Evidence   string `json:"evidence,omitempty"`
	Reason     string `json:"reason,omitempty"`
	Capability string `json:"capability,omitempty"`
}

type NodeGeometryObservations struct {
	Displayed    Observation[bool] `json:"displayed"`
	IntendedRect Observation[Rect] `json:"intendedRect"`
	VisibleRect  Observation[Rect] `json:"visibleRect"`
}

type PointerHitRegion struct {
	Rect        Rect   `json:"rect"`
	RecipientID string `json:"recipientId"`
}

type PointerHitGrid struct {
	Regions []PointerHitRegion `json:"regions"`
}

// State is the closed state set. Pointers distinguish "unset" from "false":
// an omitted state is not an assertion, a false one is.
type State struct {
	Disabled *bool `json:"disabled,omitempty"`
	Focused  *bool `json:"focused,omitempty"`
	Selected *bool `json:"selected,omitempty"`
	Checked  any   `json:"checked,omitempty"` // bool or the string "mixed"
	Expanded *bool `json:"expanded,omitempty"`
	Modal    *bool `json:"modal,omitempty"`
	Busy     *bool `json:"busy,omitempty"`
	Hidden   *bool `json:"hidden,omitempty"`
	// Offscreen says every cell is outside the visible area — scrolled away,
	// not undisplayed. Implies Hidden; the pair without it is refused.
	Offscreen     *bool  `json:"offscreen,omitempty"`
	ReadOnly      *bool  `json:"readonly,omitempty"`
	Multiline     *bool  `json:"multiline,omitempty"`
	Orientation   string `json:"orientation,omitempty"`
	Level         *int   `json:"level,omitempty"`
	PositionInSet *int   `json:"positionInSet,omitempty"`
	SetSize       *int   `json:"setSize,omitempty"`
	ScrollOffset  *int   `json:"scrollOffset,omitempty"`
	ScrollExtent  *int   `json:"scrollExtent,omitempty"`
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
	ID          string `json:"id"`
	ParentID    string `json:"parentId,omitempty"`
	Role        Role   `json:"role"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// Value is what the widget CONTAINS, as against Name, which is what it is
	// called. A pointer because the empty string is meaningful: `""` says the
	// field is empty, absent says this is not a value-bearing widget at all.
	// `omitempty` on a plain string collapses the first into the second and
	// makes toHaveValue('') unassertable.
	Value  *string `json:"value,omitempty"`
	Bounds *Rect   `json:"bounds,omitempty"`
	State  *State  `json:"state,omitempty"`
	// Extended is application-defined JSON state. It is deliberately separate
	// from State, whose portable vocabulary remains closed.
	Extended    map[string]any `json:"extended,omitempty"`
	Actions     []Action       `json:"actions,omitempty"`
	LabelledBy  []string       `json:"labelledBy,omitempty"`
	DescribedBy []string       `json:"describedBy,omitempty"`
	TextRanges  []TextRange    `json:"textRanges,omitempty"`
	TestID      string         `json:"testId,omitempty"`
	// FrameworkType is what the UI framework calls this widget. Required when
	// Role is RoleGeneric: an unrecognised widget must at least name its own
	// type, so a reader can tell one unknown thing from another.
	FrameworkType string `json:"frameworkType,omitempty"`
	// Occlusion says whether the producer can tell if these cells are covered
	// by something painted later. Only a producer that observes paint order may
	// say "known"; the driver refuses pointer actions on anything else.
	Occlusion string `json:"occlusion,omitempty"`
	// P is where this node's facts came from, as a whole.
	P string `json:"p,omitempty"`
	// PX is where individual fields came from, when they differ from P.
	PX       map[string]string         `json:"px,omitempty"`
	Geometry *NodeGeometryObservations `json:"geometry,omitempty"`
}

// Provenance sources: where a semantic fact came from. Closed set.
const (
	ProvenanceAnnotation  = "annotation"
	ProvenanceRecognizer  = "recognizer"
	ProvenanceFramework   = "framework"
	ProvenanceCorrelation = "correlation"
	ProvenanceHeuristic   = "heuristic"
)

// ProvenanceSources is every value P and PX accept.
var ProvenanceSources = []string{
	ProvenanceAnnotation, ProvenanceRecognizer, ProvenanceFramework,
	ProvenanceCorrelation, ProvenanceHeuristic,
}

// Occlusion knowledge: whether covered cells are answerable for this node.
const (
	OcclusionKnown   = "known"
	OcclusionUnknown = "unknown"
)

// Cursor is the terminal cursor position in viewport cells.
type Cursor struct {
	Row     int    `json:"row"`
	Column  int    `json:"column"`
	Visible bool   `json:"visible"`
	Shape   string `json:"shape,omitempty"`
}

// Snapshot is the whole tree for one committed render.
type Snapshot struct {
	V               int                          `json:"v"`
	SessionID       string                       `json:"sessionId"`
	Revision        int64                        `json:"revision"`
	Columns         int                          `json:"columns"`
	Rows            int                          `json:"rows"`
	Cursor          *Cursor                      `json:"cursor,omitempty"`
	RootIDs         []string                     `json:"rootIds"`
	Nodes           []Node                       `json:"nodes"`
	CoordinateSpace *Observation[string]         `json:"coordinateSpace,omitempty"`
	HitGrid         *Observation[PointerHitGrid] `json:"hitGrid,omitempty"`
}

// NewSnapshotV2 returns a qualified snapshot. Callers must populate every
// node's Geometry and explicitly qualify HitGrid, including unsupported.
func NewSnapshotV2(sessionID string, revision int64, columns, rows int) *Snapshot {
	space := "viewport-cells"
	return &Snapshot{
		V: 2, SessionID: sessionID, Revision: revision, Columns: columns, Rows: rows,
		RootIDs: []string{}, Nodes: []Node{},
		CoordinateSpace: &Observation[string]{Status: "known", Value: &space, Evidence: "adapter"},
	}
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

// Text returns a pointer to v, for Node.Value, where the empty string differs
// from no value at all.
func Text(v string) *string { return &v }
