/**
 * The driver-shaped types this package projects into MCP results.
 *
 * `@termwright/mcp` depends on `@termwright/driver` only (CONTRACTS.md
 * §Dependency rules), and the driver does not re-export the protocol types it
 * uses. Rather than forking the contract with a second declaration, every type
 * below is *derived* from the public `TerminalHarness` surface, so a change in
 * `@termwright/protocol` reaches this package through the driver.
 */
import type { TerminalHarness } from '@termwright/driver';

/** A semantic snapshot exactly as the driver hands it out. */
export type SemanticSnapshot = NonNullable<ReturnType<TerminalHarness['semanticTree']>>;

/** One node of a {@link SemanticSnapshot}. */
export type SemanticNode = SemanticSnapshot['nodes'][number];

/** The closed v1 role set. */
export type SemanticRole = SemanticNode['role'];

/** The closed v1 state set. */
export type SemanticState = NonNullable<SemanticNode['state']>;

/** Zero-based viewport cell rectangle. */
export type Rect = NonNullable<SemanticNode['bounds']>;

/** The driver's view of the visible grid. */
export type ScreenSnapshot = ReturnType<TerminalHarness['screen']>;

/** Session capabilities as reported after the semantic handshake window. */
export type SessionCapabilities = ReturnType<TerminalHarness['capabilities']>;

/**
 * Roles offered as an enum to agents (tool schemas, `agent-context`).
 *
 * The list is not a second source of truth: {@link ROLES_ARE_COMPLETE} fails to
 * compile if `@termwright/protocol` ever adds a role that is missing here.
 */
export const SEMANTIC_ROLES = [
  'application',
  'region',
  'dialog',
  'alert',
  'status',
  'list',
  'listitem',
  'menu',
  'menuitem',
  'button',
  'checkbox',
  'radio',
  'tab',
  'textbox',
  'heading',
  'text',
  'progressbar',
  'separator',
  'scrollbar',
  'table',
  'row',
  'cell',
  'generic',
] as const satisfies readonly SemanticRole[];

type MissingRole = Exclude<SemanticRole, (typeof SEMANTIC_ROLES)[number]>;

/**
 * Compile-time lock: `true` while {@link SEMANTIC_ROLES} covers every role the
 * driver can report. If a role is added upstream, this line stops type-checking
 * and names the missing member.
 */
export const ROLES_ARE_COMPLETE: [MissingRole] extends [never] ? true : ['missing roles', MissingRole] =
  true as [MissingRole] extends [never] ? true : ['missing roles', MissingRole];

/** State flags an agent may filter on; the value type follows {@link SemanticState}. */
export const FILTERABLE_STATES = [
  'disabled',
  'focused',
  'selected',
  'checked',
  'expanded',
  'modal',
  'busy',
  'hidden',
  'readonly',
] as const satisfies readonly (keyof SemanticState)[];

/** Signals `terminal.signal` accepts, mirroring `TerminalHarness['signal']`. */
export const SIGNALS = ['INT', 'TERM', 'KILL', 'HUP'] as const satisfies readonly Parameters<
  TerminalHarness['signal']
>[0][];
