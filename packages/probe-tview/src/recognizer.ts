/**
 * IR → semantic tree, as a pure function.
 *
 * The Go probe normalises inside the copy, because that is where the private
 * state is. This module is the same normalisation expressed over Probe IR, and
 * it exists for two reasons that are worth stating, since duplicated logic is
 * usually a smell:
 *
 * 1. **It is testable without a process.** The B tier of the campaign's test
 *    plan feeds IR in and inspects the tree that comes out — no build, no
 *    toolchain, no pseudo-terminal, and every edge case reachable in one line
 *    instead of being coaxed out of a running application.
 * 2. **It is the contract the Go side is held to.** The recorded IR of a real
 *    frame goes through here, and the result must match what the probe
 *    published. Two implementations that disagree describe the same
 *    application differently, which is the failure mode the convergence round
 *    existed to prevent.
 */

import { evidence, type ProbeFrame, type ProbeObject } from '@termwright/protocol';
import type { SemanticNode, SemanticRole, SemanticSnapshot } from '@termwright/protocol';

/**
 * tview widget type → role.
 *
 * Keyed on the framework's own type name, which the probe reports for every
 * object. Anything absent from this table is deliberately *not* a failure: it
 * becomes `generic` and keeps its `frameworkType`, so a widget added by a
 * future tview release is still addressable rather than dropped.
 */
const ROLE_BY_TYPE: Readonly<Record<string, SemanticRole>> = {
  Button: 'button',
  Checkbox: 'checkbox',
  InputField: 'textbox',
  TextArea: 'textbox',
  DropDown: 'list',
  List: 'list',
  TreeView: 'list',
  Table: 'table',
  TextView: 'text',
  Modal: 'dialog',
  Form: 'region',
  Flex: 'region',
  Grid: 'region',
  Pages: 'region',
  Frame: 'region',
  Box: 'region',
};

/** What a recognizer needs to know about the frame it is given. */
export interface RecognizeOptions {
  readonly sessionId: string;
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
}

/** Resolves one object's role from its framework type. */
export function roleFor(frameworkType: string): SemanticRole {
  return ROLE_BY_TYPE[frameworkType] ?? 'generic';
}

/**
 * Normalises one observed frame into a semantic snapshot.
 *
 * Facts are carried across, never invented. An object without geometry stays
 * without bounds; a state the probe did not report stays absent, because
 * "the probe did not say" and "the widget is not focused" are different
 * claims and only one of them is safe to make.
 */
export function recognize(frame: ProbeFrame, options: RecognizeOptions): SemanticSnapshot {
  const nodes: SemanticNode[] = [];
  const rootIds: string[] = [];

  for (const object of frame.objects) {
    const node = recognizeObject(object);
    nodes.push(node);
    if (object.parent === undefined) rootIds.push(object.identity.value);
  }

  return {
    v: 2,
    sessionId: options.sessionId,
    revision: options.revision,
    columns: options.columns,
    rows: options.rows,
    rootIds,
    nodes,
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence('framework', 'instrumented', 'authoritative', 'tview') },
    hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
  };
}

function recognizeObject(object: ProbeObject): SemanticNode {
  const role = roleFor(object.frameworkType);
  const state = recognizeState(object);

  return {
    id: object.identity.value,
    role,
    // The framework's own name survives on every node, not only generic ones:
    // it is what lets a reader tell a Flex-shaped region from a Form-shaped
    // one after both became `region`.
    frameworkType: object.frameworkType,
    name: object.annotations?.name ?? object.text ?? '',
    ...(object.parent === undefined ? {} : { parentId: object.parent }),
    geometry: {
      displayed: object.state?.displayed === undefined
        ? { status: 'unsupported', capability: 'displayed', reason: 'framework-unobservable' }
        : { status: 'known', value: object.state.displayed, evidence: evidence('framework', 'instrumented', 'authoritative', 'tview') },
      intendedRect: object.geometry?.intendedRect === undefined
        ? { status: 'unsupported', capability: 'intended-geometry', reason: 'framework-unobservable' }
        : { status: 'known', value: object.geometry.intendedRect, evidence: evidence('framework', 'instrumented', 'authoritative', 'tview') },
      visibleRect: { status: 'unsupported', capability: 'visible-rect', reason: 'framework-unobservable' },
    },
    ...(object.state?.value === undefined ? {} : { value: {
      status: 'known' as const,
      value: object.state.value,
      sensitivity: object.state?.valueSensitivity ?? 'sensitive',
      evidence: evidence('framework', 'instrumented', 'authoritative', 'tview'),
    } }),
    ...(state === undefined ? {} : { state }),
  } as SemanticNode;
}

function recognizeState(object: ProbeObject): SemanticNode['state'] {
  const observed = object.state;
  if (observed === undefined) return undefined;

  const state: Record<string, unknown> = {};
  if (observed.focused !== undefined) state['focused'] = observed.focused;
  if (observed.disabled !== undefined) state['disabled'] = observed.disabled;
  if (observed.checked !== undefined) state['checked'] = observed.checked;
  if (observed.expanded !== undefined) state['expanded'] = observed.expanded;
  if (observed.readonly !== undefined) state['readonly'] = observed.readonly;
  // `displayed: false` is the probe's way of saying the framework hid it; the
  // wire calls that `hidden`, and the inversion is the whole translation.
  if (observed.displayed === false) state['hidden'] = true;
  if (observed.selectedIndex !== undefined) state['positionInSet'] = observed.selectedIndex + 1;
  return Object.keys(state).length === 0 ? undefined : (state as SemanticNode['state']);
}
