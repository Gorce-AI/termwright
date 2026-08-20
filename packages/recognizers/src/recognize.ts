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
  DEFAULT_LIMITS,
  resolveNodeBounds,
  SEMANTIC_ROLES,
  type ProbeFrame,
  type ProbeObject,
  type Observation,
  type ProvenanceSource,
  type Rect,
  type SemanticNode,
  type SemanticRole,
  type SemanticSnapshot,
  type SemanticState,
} from '@termwright/protocol';
import { namesFromContent, normalizeName } from './naming.js';
import { roleForInkAria, roleForInkHost } from './ink.js';
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
  /** Bound for a name correlated from descendant text. */
  readonly maxStringBytes?: number;
  /** Emit the explicit qualified geometry contract instead of legacy v1. */
  readonly qualified?: boolean;
}

const ROLES: ReadonlySet<string> = new Set(SEMANTIC_ROLES);
const UTF8_ENCODER = new TextEncoder();

/** Level-2 maps, by framework. Others land on `generic`, which is legitimate. */
const ROLE_MAPS: Readonly<Record<string, (frameworkType: string) => SemanticRole | undefined>> =
  Object.freeze({ ink: roleForInkHost, opentui: roleForOpenTuiClass });

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
  if (framework === 'ink' && object.accessibility?.role !== undefined) {
    const mapped = roleForInkAria(object.accessibility.role);
    if (mapped !== undefined) return { role: mapped, source: 'framework' };
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
  subtreeText: ReadonlyMap<string, string>,
): { name: string; source: ProvenanceSource } {
  const annotated = object.annotations?.name;
  if (annotated !== undefined) return { name: annotated, source: 'annotation' };
  if (object.accessibility?.name !== undefined) {
    return { name: object.accessibility.name, source: 'framework' };
  }
  if (namesFromContent(role) && object.text !== undefined) {
    return { name: normalizeName(object.text), source: 'framework' };
  }
  if (namesFromContent(role)) {
    const correlated = subtreeText.get(object.identity.value);
    if (correlated !== undefined && correlated.length > 0) {
      return { name: normalizeName(correlated), source: 'recognizer' };
    }
  }
  return { name: '', source: 'recognizer' };
}

/**
 * Text reachable below each object, bounded once at every subtree.
 *
 * Probe IR keeps own text and descendants separate. Name-from-content is a
 * recognizer inference over parent links, not a reason for a probe to claim a
 * container directly carried its children's string. A nested annotated host is
 * an accessible-content boundary: it can name itself, but its label must not
 * leak into an outer control.
 */
function collectSubtreeText(
  frame: ProbeFrame,
  maxStringBytes: number,
): ReadonlyMap<string, string> {
  const objectById = new Map(frame.objects.map((object) => [object.identity.value, object]));
  const children = new Map<string, string[]>();
  for (const object of frame.objects) {
    if (object.parent === undefined || !objectById.has(object.parent)) continue;
    const siblings = children.get(object.parent) ?? [];
    siblings.push(object.identity.value);
    children.set(object.parent, siblings);
  }

  const memo = new Map<string, string>();
  const visiting = new Set<string>();
  const collect = (id: string): string => {
    const held = memo.get(id);
    if (held !== undefined) return held;
    if (visiting.has(id)) return '';
    visiting.add(id);
    const object = objectById.get(id);
    let result = object?.text ?? '';
    for (const child of children.get(id) ?? []) {
      const childText = collect(child);
      const childObject = objectById.get(child);
      if (
        childObject?.annotations?.role !== undefined
        || childObject?.accessibility?.role !== undefined
      ) continue;
      if (childText.length === 0) continue;
      // Separate host elements are separate content runs. Raw text fragments
      // inside one host were already joined by the probe, but sibling hosts
      // need a word boundary (`<Text>Save</Text><Text>now</Text>`).
      result = clampUtf8(result.length === 0 ? childText : `${result} ${childText}`, maxStringBytes);
      if (UTF8_ENCODER.encode(result).byteLength >= maxStringBytes) break;
    }
    visiting.delete(id);
    result = clampUtf8(result, maxStringBytes);
    memo.set(id, result);
    return result;
  };

  for (const object of frame.objects) collect(object.identity.value);
  return memo;
}

function clampUtf8(value: string, maxBytes: number): string {
  if (UTF8_ENCODER.encode(value).byteLength <= maxBytes) return value;
  let result = '';
  let bytes = 0;
  for (const codePoint of value) {
    const size = UTF8_ENCODER.encode(codePoint).byteLength;
    if (bytes + size > maxBytes) break;
    result += codePoint;
    bytes += size;
  }
  return result;
}

/** Map observed state onto the protocol's closed state set. */
function resolveState(
  object: ProbeObject,
  hiddenByGeometry: boolean,
  offscreen: boolean,
): SemanticState | undefined {
  const observed = object.state;
  const state: Record<string, unknown> = {};

  if (observed?.focused !== undefined) state['focused'] = observed.focused;
  if (observed?.disabled !== undefined) state['disabled'] = observed.disabled;
  if (observed?.checked !== undefined) state['checked'] = observed.checked;
  if (observed?.expanded !== undefined) state['expanded'] = observed.expanded;
  if (observed?.readonly !== undefined) state['readonly'] = observed.readonly;
  if (observed?.selected !== undefined) state['selected'] = observed.selected;
  if (observed?.busy !== undefined) state['busy'] = observed.busy;
  if (observed?.multiline !== undefined) state['multiline'] = observed.multiline;
  if (observed?.displayed !== undefined) state['hidden'] = !observed.displayed;
  // Probe IR keeps item selection distinct from a text range. The semantic
  // tree represents the highlighted item's zero-based index as the matching
  // one-based collection position.
  if (observed?.selectedIndex !== undefined) state['positionInSet'] = observed.selectedIndex + 1;
  if (observed?.scroll !== undefined) state['scrollOffset'] = observed.scroll.row;
  if (observed?.scrollExtent !== undefined) state['scrollExtent'] = observed.scrollExtent.rows;

  // Clipped entirely away is a different fact from the framework's own display
  // flag, and both end up as `hidden` because the wire has one field for it.
  if (hiddenByGeometry) state['hidden'] = true;
  if (offscreen) {
    state['hidden'] = true;
    state['offscreen'] = true;
  }

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
  // Ink boxes do not own their rendered label; it survives only in descendant
  // text hosts. Other framework probes already define the meaning of their own
  // `text` field and must not silently gain Ink's host-specific correlation.
  const subtreeText: ReadonlyMap<string, string> = context.framework === 'ink'
    ? collectSubtreeText(frame, context.maxStringBytes ?? DEFAULT_LIMITS.maxStringBytes)
    : new Map();
  const idByIdentity = new Map<string, string>();
  for (const object of frame.objects) {
    idByIdentity.set(object.identity.value, `n${object.identity.value}`);
  }

  const nodes: SemanticNode[] = [];
  const rootIds: string[] = [];

  for (const object of frame.objects) {
    const id = idByIdentity.get(object.identity.value) as string;
    const { role, source: roleSource } = resolveRole(object, context.framework);
    const { name, source: nameSource } = resolveName(object, role, subtreeText);

    const bounds =
      object.geometry === undefined
        ? undefined
        : resolveNodeBounds(object.geometry, {
            // The terminal viewport is always a real, known clip even when the
            // framework cannot expose clips imposed by intermediate widgets.
            clip: { row: 0, column: 0, width: context.columns, height: context.rows },
            // Paint order is not a hit test. Until the normalized contract
            // carries the topmost recipient at a concrete point, v1 must not
            // promote either a frame-level flag or an object's order number to
            // `occlusion: known`.
            paintOrderKnown: false,
          });

    const hiddenByGeometry =
      bounds !== undefined && (bounds.rect.width === 0 || bounds.rect.height === 0);
    const state = resolveState(object, hiddenByGeometry, bounds?.clippedAway ?? false);
    const parentId = object.parent === undefined ? undefined : idByIdentity.get(object.parent);
    if (parentId === undefined) rootIds.push(id);

    // One source for the node, exceptions listed. Physical facts always come
    // from the framework: an annotation may not move a widget on screen.
    const px: Record<string, ProvenanceSource> = {};
    if (nameSource !== roleSource) px['name'] = nameSource;
    if (bounds !== undefined) px[context.qualified ? 'geometry' : 'bounds'] = 'framework';
    if (state !== undefined) px['state'] = 'framework';
    if (object.annotations?.description !== undefined && roleSource !== 'annotation') {
      px['description'] = 'annotation';
    } else if (object.accessibility?.description !== undefined && roleSource !== 'framework') {
      px['description'] = 'framework';
    }
    if (object.annotations?.testId !== undefined && roleSource !== 'annotation') {
      px['testId'] = 'annotation';
    }
    if (object.annotations?.extended !== undefined && roleSource !== 'annotation') {
      px['extended'] = 'annotation';
    }
    if (object.annotations?.actions !== undefined && roleSource !== 'annotation') {
      px['actions'] = 'annotation';
    }
    if (object.annotations?.labelledBy !== undefined && roleSource !== 'annotation') {
      px['labelledBy'] = 'annotation';
    }
    if (object.annotations?.describedBy !== undefined && roleSource !== 'annotation') {
      px['describedBy'] = 'annotation';
    }

    const labelledBy = object.annotations?.labelledBy
      ?.map((identity) => idByIdentity.get(identity))
      .filter((target): target is string => target !== undefined);
    const describedBy = object.annotations?.describedBy
      ?.map((identity) => idByIdentity.get(identity))
      .filter((target): target is string => target !== undefined);

    const displayed: Observation<boolean> = object.state?.displayed !== undefined
      ? { status: 'known', value: object.state.displayed, evidence: 'probe' }
      : object.unobservable?.includes('displayed') === true
        ? { status: 'unsupported', capability: 'displayed', reason: 'framework-unobservable' }
        : { status: 'unknown', reason: 'not-reported' };
    const intendedRect: Observation<Rect> = object.geometry?.intendedRect !== undefined
      ? { status: 'known', value: object.geometry.intendedRect, evidence: 'probe' }
      : object.unobservable?.includes('intendedRect') === true
        ? { status: 'unsupported', capability: 'intended-rect', reason: 'framework-unobservable' }
        : { status: 'unknown', reason: 'not-reported' };
    const visibleRect: Observation<Rect> = displayed.status === 'known' && displayed.value === false
      ? { status: 'absent', reason: 'not-displayed' }
      : object.geometry?.visibleRect !== undefined
        ? { status: 'known', value: object.geometry.visibleRect, evidence: 'viewport-clip' }
        : object.unobservable?.includes('visibleRect') === true
          ? { status: 'unsupported', capability: 'visible-rect', reason: 'framework-unobservable' }
          : { status: 'unknown', reason: 'not-reported' };

    nodes.push({
      id,
      ...(parentId === undefined ? {} : { parentId }),
      role,
      name,
      ...(object.annotations?.description === undefined
        ? object.accessibility?.description === undefined
          ? {}
          : { description: object.accessibility.description }
        : { description: object.annotations.description }),
      frameworkType: object.frameworkType,
      ...(context.qualified
        ? { geometry: { displayed, intendedRect, visibleRect } }
        : {
            ...(bounds === undefined ? {} : { bounds: bounds.rect }),
            ...(bounds === undefined ? {} : { occlusion: bounds.occlusion }),
          }),
      ...(state === undefined ? {} : { state }),
      ...(object.annotations?.testId === undefined
        ? {}
        : { testId: object.annotations.testId }),
      ...(object.annotations?.extended === undefined
        ? {}
        : { extended: object.annotations.extended }),
      ...(object.annotations?.actions === undefined
        ? {}
        : { actions: object.annotations.actions }),
      ...(labelledBy === undefined || labelledBy.length === 0 ? {} : { labelledBy }),
      ...(describedBy === undefined || describedBy.length === 0 ? {} : { describedBy }),
      ...(object.state?.value === undefined ? {} : { value: object.state.value }),
      p: roleSource,
      ...(Object.keys(px).length === 0 ? {} : { px }),
    });
  }

  return context.qualified ? {
    v: 2,
    sessionId: context.sessionId,
    revision: context.revision,
    columns: context.columns,
    rows: context.rows,
    rootIds,
    nodes,
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: 'probe' },
    hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
  } : {
    v: 1,
    sessionId: context.sessionId,
    revision: context.revision,
    columns: context.columns,
    rows: context.rows,
    rootIds,
    nodes,
  };
}
