/**
 * Probe IR → semantic tree.
 *
 * The probe reports what it saw; this decides what it means. Keeping the two
 * apart is what lets six frameworks disagree about what is knowable without
 * that disagreement leaking into the tree — and it is why this module is a pure
 * function over data, testable without a process, a framework or a socket.
 *
 * Merge precedence, from decision D6: **annotation > recognizer > framework >
 * correlation > heuristic**, with one exception that matters more than the
 * order does — physical facts are never overridden by an annotation. An author
 * may name a thing; an author may not declare where it is on screen, whether it
 * has focus, or whether it is visible.
 */

import {
  resolveNodeBounds,
  SEMANTIC_ROLES,
  type ProbeFrame,
  type ProbeObject,
  type ProvenanceSource,
  type SemanticNode,
  type SemanticRole,
  type SemanticSnapshot,
  type SemanticState,
} from '@termwright/protocol';
import { namesFromContent, normalizeName } from './naming.js';
import { roleForOpenTuiClass } from './opentui.js';

/** Everything the tree needs that a frame does not carry. */
export interface RecognizeContext {
  readonly sessionId: string;
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  /** Which framework produced the frame; selects the level-2 role map. */
  readonly framework: string;
  /** Whether the probe reported paint order, which decides occlusion. */
  readonly paintOrderKnown?: boolean;
}

const ROLES: ReadonlySet<string> = new Set(SEMANTIC_ROLES);

/** Level-2 maps, by framework. Others land on `generic`, which is legitimate. */
const ROLE_MAPS: Readonly<Record<string, (frameworkType: string) => SemanticRole | undefined>> =
  Object.freeze({ opentui: roleForOpenTuiClass });

/**
 * Resolve a role, in the normative order.
 *
 * An annotation that names a role outside the closed set is **not** silently
 * dropped: it falls through to the framework map, and the bad value stays
 * visible in the annotations rather than becoming an invented role.
 */
function resolveRole(object: ProbeObject, framework: string): {
  role: SemanticRole;
  source: ProvenanceSource;
} {
  const annotated = object.annotations?.role;
  if (annotated !== undefined && ROLES.has(annotated)) {
    return { role: annotated as SemanticRole, source: 'annotation' };
  }
  const mapped = ROLE_MAPS[framework]?.(object.frameworkType);
  if (mapped !== undefined) return { role: mapped, source: 'recognizer' };
  return { role: 'generic', source: 'recognizer' };
}

/**
 * Resolve a name.
 *
 * An annotation wins, including a deliberate empty string. Otherwise the text
 * the probe observed is used **only** for roles that take their name from
 * content; everything else keeps an empty name rather than absorbing the label
 * of something inside it.
 */
function resolveName(
  object: ProbeObject,
  role: SemanticRole,
): { name: string; source: ProvenanceSource } {
  const annotated = object.annotations?.name;
  if (annotated !== undefined) return { name: annotated, source: 'annotation' };
  if (namesFromContent(role) && object.text !== undefined) {
    return { name: normalizeName(object.text), source: 'framework' };
  }
  return { name: '', source: 'recognizer' };
}

/** Map observed state onto the protocol's closed state set. */
function resolveState(object: ProbeObject, hidden: boolean): SemanticState | undefined {
  const observed = object.state;
  const state: Record<string, unknown> = {};

  if (observed?.focused !== undefined) state['focused'] = observed.focused;
  if (observed?.disabled !== undefined) state['disabled'] = observed.disabled;
  if (observed?.checked !== undefined) state['checked'] = observed.checked;
  if (observed?.expanded !== undefined) state['expanded'] = observed.expanded;
  if (observed?.readonly !== undefined) state['readonly'] = observed.readonly;
  if (observed?.displayed === false) state['hidden'] = true;
  if (observed?.scroll !== undefined) state['scrollOffset'] = observed.scroll.row;
  if (observed?.scrollExtent !== undefined) state['scrollExtent'] = observed.scrollExtent.rows;

  // Clipped entirely away is a different fact from the framework's own display
  // flag, and both end up as `hidden` because the wire has one field for it.
  if (hidden) state['hidden'] = true;

  return Object.keys(state).length === 0 ? undefined : (state as SemanticState);
}

/**
 * Turn one observed frame into a semantic snapshot.
 *
 * Every object becomes a node: nothing is dropped for being unrecognised, which
 * is what `generic` plus `frameworkType` is for. Parent links are rewritten
 * from probe identities to node ids, and an object whose parent did not survive
 * is attached to the root rather than left dangling — a snapshot with a missing
 * parent is refused by validation, and losing the subtree would be worse than
 * reparenting it.
 */
export function recognize(frame: ProbeFrame, context: RecognizeContext): SemanticSnapshot {
  const idByIdentity = new Map<string, string>();
  for (const object of frame.objects) {
    idByIdentity.set(object.identity.value, `n${object.identity.value}`);
  }

  const nodes: SemanticNode[] = [];
  const rootIds: string[] = [];

  for (const object of frame.objects) {
    const id = idByIdentity.get(object.identity.value) as string;
    const { role, source: roleSource } = resolveRole(object, context.framework);
    const { name, source: nameSource } = resolveName(object, role);

    const bounds =
      object.geometry === undefined
        ? undefined
        : resolveNodeBounds(object.geometry, {
            paintOrderKnown: context.paintOrderKnown ?? object.paintOrder !== undefined,
          });

    const state = resolveState(object, bounds?.clippedAway ?? false);
    const parentId = object.parent === undefined ? undefined : idByIdentity.get(object.parent);
    if (parentId === undefined) rootIds.push(id);

    // One source for the node, exceptions listed. Physical facts always come
    // from the framework: an annotation may not move a widget on screen.
    const px: Record<string, ProvenanceSource> = {};
    if (nameSource !== roleSource) px['name'] = nameSource;
    if (bounds !== undefined) px['bounds'] = 'framework';
    if (state !== undefined) px['state'] = 'framework';

    nodes.push({
      id,
      ...(parentId === undefined ? {} : { parentId }),
      role,
      name,
      frameworkType: object.frameworkType,
      ...(bounds === undefined ? {} : { bounds: bounds.rect }),
      ...(state === undefined ? {} : { state }),
      ...(object.annotations?.testId === undefined
        ? {}
        : { testId: object.annotations.testId }),
      ...(object.state?.value === undefined ? {} : { value: object.state.value }),
      p: roleSource,
      ...(Object.keys(px).length === 0 ? {} : { px }),
    });
  }

  return {
    v: 1,
    sessionId: context.sessionId,
    revision: context.revision,
    columns: context.columns,
    rows: context.rows,
    rootIds,
    nodes,
  };
}
