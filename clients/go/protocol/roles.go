package protocol

// Role is a v1 semantic role. The set is closed and ARIA-aligned: an unknown
// role is rejected during validation rather than silently acquiring behaviour.
type Role string

// The v1 roles.
const (
	RoleApplication Role = "application"
	RoleRegion      Role = "region"
	RoleDialog      Role = "dialog"
	RoleAlert       Role = "alert"
	RoleStatus      Role = "status"
	RoleList        Role = "list"
	RoleListItem    Role = "listitem"
	RoleMenu        Role = "menu"
	RoleMenuItem    Role = "menuitem"
	RoleButton      Role = "button"
	RoleCheckbox    Role = "checkbox"
	RoleRadio       Role = "radio"
	RoleTab         Role = "tab"
	RoleTextbox     Role = "textbox"
	RoleHeading     Role = "heading"
	RoleText        Role = "text"
	RoleProgressBar Role = "progressbar"
	RoleSeparator   Role = "separator"
	RoleScrollbar   Role = "scrollbar"
	RoleTable       Role = "table"
	RoleRow         Role = "row"
	RoleCell        Role = "cell"
	RoleGeneric     Role = "generic"
)

// Action is a descriptive capability hint: a diagnostic, never a callback.
type Action string

// The v1 actions.
const (
	ActionFocus    Action = "focus"
	ActionActivate Action = "activate"
	ActionToggle   Action = "toggle"
	ActionSetValue Action = "setValue"
	ActionScroll   Action = "scroll"
	ActionSelect   Action = "select"
	ActionExpand   Action = "expand"
)

// Capability is something an adapter tells the driver it can provide.
type Capability string

// The v1 capabilities.
const (
	CapTree            Capability = "tree"
	CapBounds          Capability = "bounds"
	CapAbsoluteBounds  Capability = "absolute-bounds"
	CapStates          Capability = "states"
	CapActions         Capability = "actions"
	CapTextRanges      Capability = "text-ranges"
	CapRenderRevisions Capability = "render-revisions"
	CapTreeDiffs       Capability = "tree-diffs"
	CapLogs            Capability = "logs"
)

var roleSet = map[Role]struct{}{
	RoleApplication: {}, RoleRegion: {}, RoleDialog: {}, RoleAlert: {},
	RoleStatus: {}, RoleList: {}, RoleListItem: {}, RoleMenu: {},
	RoleMenuItem: {}, RoleButton: {}, RoleCheckbox: {}, RoleRadio: {},
	RoleTab: {}, RoleTextbox: {}, RoleHeading: {}, RoleText: {},
	RoleProgressBar: {}, RoleSeparator: {}, RoleScrollbar: {}, RoleTable: {},
	RoleRow: {}, RoleCell: {}, RoleGeneric: {},
}

var actionSet = map[Action]struct{}{
	ActionFocus: {}, ActionActivate: {}, ActionToggle: {}, ActionSetValue: {},
	ActionScroll: {}, ActionSelect: {}, ActionExpand: {},
}

var capabilitySet = map[Capability]struct{}{
	CapTree: {}, CapBounds: {}, CapAbsoluteBounds: {}, CapStates: {},
	CapActions: {}, CapTextRanges: {}, CapRenderRevisions: {}, CapTreeDiffs: {},
	CapLogs: {},
}

// ValidRole reports whether r is one of the v1 roles.
func ValidRole(r Role) bool { _, ok := roleSet[r]; return ok }

// ValidAction reports whether a is one of the v1 actions.
func ValidAction(a Action) bool { _, ok := actionSet[a]; return ok }

// ValidCapability reports whether c is one of the v1 capabilities.
func ValidCapability(c Capability) bool { _, ok := capabilitySet[c]; return ok }

// ActionCount is the size of the closed action set, used as an array bound.
const ActionCount = 7

// CapabilityCount is the size of the closed capability set.
const CapabilityCount = 9
