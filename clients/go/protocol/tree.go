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
	Status     string              `json:"status"`
	Value      *T                  `json:"value,omitempty"`
	Evidence   *EvidenceProvenance `json:"evidence,omitempty"`
	Reason     string              `json:"reason,omitempty"`
	Capability string              `json:"capability,omitempty"`
}

// EvidenceProvenance identifies how a known or authoritatively absent
// observation was established.
type EvidenceProvenance struct {
	Source     string `json:"source"`
	Method     string `json:"method"`
	Strength   string `json:"strength"`
	ProviderID string `json:"providerId"`
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

// ProviderPointerSpan is one half-open row run owned by a recipient.
type ProviderPointerSpan struct {
	Row  int `json:"row"`
	From int `json:"from"`
	To   int `json:"to"`
}

// ProviderPointerRegion is pointer-only evidence. RegionBounds is not layout
// geometry or visual clipping.
type ProviderPointerRegion struct {
	RecipientID  string                `json:"recipientId"`
	RegionBounds Rect                  `json:"regionBounds"`
	Spans        []ProviderPointerSpan `json:"spans"`
}

// ProviderRevisionEvidence binds one frozen application provider to a session
// and semantic revision. Status is available, lost, or violation.
type ProviderRevisionEvidence struct {
	ProviderID     string                   `json:"providerId"`
	SessionID      string                   `json:"sessionId"`
	Revision       int64                    `json:"revision"`
	Status         string                   `json:"status"`
	Evidence       *EvidenceProvenance      `json:"evidence,omitempty"`
	PointerRegions *[]ProviderPointerRegion `json:"pointerRegions,omitempty"`
	HitGrid        *PointerHitGrid          `json:"hitGrid,omitempty"`
	Reason         string                   `json:"reason,omitempty"`
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

// Node is one accessible element.
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
	Value *string `json:"value,omitempty"`
	State *State  `json:"state,omitempty"`
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
	// P is where this node's facts came from, as a whole.
	P string `json:"p,omitempty"`
	// PX is where individual fields came from, when they differ from P.
	PX       map[string]string        `json:"px,omitempty"`
	Geometry NodeGeometryObservations `json:"geometry"`
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

// Cursor is the terminal cursor position in viewport cells.
type Cursor struct {
	Row     int    `json:"row"`
	Column  int    `json:"column"`
	Visible bool   `json:"visible"`
	Shape   string `json:"shape,omitempty"`
}

// Snapshot is the whole tree for one committed render.
type Snapshot struct {
	V                int                         `json:"v"`
	SessionID        string                      `json:"sessionId"`
	Revision         int64                       `json:"revision"`
	Columns          int                         `json:"columns"`
	Rows             int                         `json:"rows"`
	Cursor           *Cursor                     `json:"cursor,omitempty"`
	RootIDs          []string                    `json:"rootIds"`
	Nodes            []Node                      `json:"nodes"`
	CoordinateSpace  Observation[string]         `json:"coordinateSpace"`
	HitGrid          Observation[PointerHitGrid] `json:"hitGrid"`
	ProviderEvidence []ProviderRevisionEvidence  `json:"providerEvidence,omitempty"`
}

// NewSnapshot returns an evidence-qualified snapshot. Callers must populate
// every node's Geometry and explicitly qualify all observable facts.
func NewSnapshot(sessionID string, revision int64, columns, rows int) *Snapshot {
	space := "viewport-cells"
	return &Snapshot{
		V: 2, SessionID: sessionID, Revision: revision, Columns: columns, Rows: rows,
		RootIDs: []string{}, Nodes: []Node{},
		CoordinateSpace: Observation[string]{Status: "known", Value: &space, Evidence: DefaultEvidence("semantic-adapter")},
		HitGrid:         Observation[PointerHitGrid]{Status: "unsupported", Capability: string(CapPointerHitGrid), Reason: "not-negotiated"},
	}
}

// DefaultEvidence describes an authoritative fact declared by an adapter.
func DefaultEvidence(providerID string) *EvidenceProvenance {
	return &EvidenceProvenance{Source: "application", Method: "declared", Strength: "authoritative", ProviderID: providerID}
}

// Bool returns a pointer to v, for the optional State fields.
func Bool(v bool) *bool { return &v }

// Int returns a pointer to v, for the optional State fields.
func Int(v int) *int { return &v }

// Text returns a pointer to v, for Node.Value, where the empty string differs
// from no value at all.
func Text(v string) *string { return &v }
