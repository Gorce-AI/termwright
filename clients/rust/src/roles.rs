//! Closed vocabularies. Unknown members are rejected, never passed through.

use serde::{Deserialize, Serialize};

/// A v1 semantic role. ARIA-aligned and closed: unknown roles fail validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// The application as a whole.
    Application,
    /// A grouping container with no stronger meaning.
    Region,
    /// A dialog, modal or not.
    Dialog,
    /// An urgent message.
    Alert,
    /// A non-urgent status message.
    Status,
    /// A collection of items.
    List,
    /// One entry in a list.
    #[serde(rename = "listitem")]
    ListItem,
    /// A menu of commands.
    Menu,
    /// One command in a menu.
    #[serde(rename = "menuitem")]
    MenuItem,
    /// An activatable control.
    Button,
    /// A two- or three-state toggle.
    Checkbox,
    /// One option in a mutually exclusive set.
    Radio,
    /// One tab in a tab strip.
    Tab,
    /// An editable text field.
    Textbox,
    /// A section heading.
    Heading,
    /// Static text.
    Text,
    /// Progress towards completion.
    #[serde(rename = "progressbar")]
    ProgressBar,
    /// A visual divider.
    Separator,
    /// A scroll position indicator.
    Scrollbar,
    /// A grid of rows and cells.
    Table,
    /// One row of a table.
    Row,
    /// One cell of a table row.
    Cell,
    /// No more specific role applies.
    Generic,
}

/// Every v1 role, in the order the reference implementation declares them.
pub const SEMANTIC_ROLES: [&str; 23] = [
    "application",
    "region",
    "dialog",
    "alert",
    "status",
    "list",
    "listitem",
    "menu",
    "menuitem",
    "button",
    "checkbox",
    "radio",
    "tab",
    "textbox",
    "heading",
    "text",
    "progressbar",
    "separator",
    "scrollbar",
    "table",
    "row",
    "cell",
    "generic",
];

/// A descriptive capability hint: a diagnostic, never a callback endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    /// The node can take focus.
    Focus,
    /// The node can be activated (pressed, chosen).
    Activate,
    /// The node's checked state can be flipped.
    Toggle,
    /// The node's value can be replaced.
    SetValue,
    /// The node's viewport can be scrolled.
    Scroll,
    /// The node can be selected within its set.
    Select,
    /// The node can be expanded or collapsed.
    Expand,
}

/// Every v1 action.
pub const SEMANTIC_ACTIONS: [&str; 7] = [
    "focus", "activate", "toggle", "setValue", "scroll", "select", "expand",
];

/// Something the adapter tells the driver it can provide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    /// Publishes a node tree.
    Tree,
    /// Publishes bounds for its nodes.
    Bounds,
    /// The published bounds are absolute viewport cells.
    AbsoluteBounds,
    /// Publishes state flags.
    States,
    /// Publishes action hints.
    Actions,
    /// Publishes offset-to-cell mappings.
    TextRanges,
    /// Emits a render-commit marker per revision.
    RenderRevisions,
    /// Can publish subtree diffs instead of full trees.
    TreeDiffs,
    /// Can forward application log records over the channel.
    Logs,
}

/// Every v1 capability.
pub const ADAPTER_CAPABILITIES: [&str; 9] = [
    "tree",
    "bounds",
    "absolute-bounds",
    "states",
    "actions",
    "text-ranges",
    "render-revisions",
    "tree-diffs",
    "logs",
];

/// Whether `role` is one of the v1 roles.
pub fn valid_role(role: &str) -> bool {
    SEMANTIC_ROLES.contains(&role)
}

/// Whether `action` is one of the v1 actions.
pub fn valid_action(action: &str) -> bool {
    SEMANTIC_ACTIONS.contains(&action)
}

/// Whether `capability` is one of the v1 capabilities.
pub fn valid_capability(capability: &str) -> bool {
    ADAPTER_CAPABILITIES.contains(&capability)
}
