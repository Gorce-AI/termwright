/**
 * The protocol- and driver-shaped types this package projects into MCP results.
 *
 * Roles, states and snapshot types come straight from `@termwright/protocol`
 * (CONTRACTS.md §Dependency rules allows `mcp` to import its constants and
 * types), so there is exactly one source of truth for the closed sets an agent
 * sees in the tool schemas. Screen- and session-shaped types come from the
 * driver, which owns them.
 */
import type { TerminalHarness } from '@termwright/driver';
import { SEMANTIC_ROLES } from '@termwright/protocol';
import type {
  Rect,
  SemanticNode,
  SemanticRole,
  SemanticSnapshot,
  SemanticState,
} from '@termwright/protocol';

export { SEMANTIC_ROLES };
export type { Rect, SemanticNode, SemanticRole, SemanticSnapshot, SemanticState };

/** The driver's view of the visible grid. */
export type ScreenSnapshot = ReturnType<TerminalHarness['screen']>;

/** The role type the driver actually reports on a semantic node. */
type DriverRole = NonNullable<ReturnType<TerminalHarness['semanticTree']>>['nodes'][number]['role'];

type RoleDrift = Exclude<DriverRole, SemanticRole> | Exclude<SemanticRole, DriverRole>;

/**
 * Regression lock: `true` while the roles the driver reports are exactly the
 * roles `@termwright/protocol` defines. If the two ever diverge, this line stops
 * type-checking and names the offending member — the tool schemas below build on
 * the protocol's list, so a silent drift would let an agent ask for a role the
 * driver can never match.
 */
export const ROLES_ARE_COMPLETE: [RoleDrift] extends [never] ? true : ['role drift', RoleDrift] =
  true as [RoleDrift] extends [never] ? true : ['role drift', RoleDrift];

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
