/** Builders for hand-written semantic trees used across this package's tests. */

import type { SemanticNode, SemanticRole, SemanticSnapshot, SemanticState } from '@termwright/protocol';

/** Builds a node; `parentId` and `state` are omitted rather than set to `undefined`. */
export function node(
  id: string,
  role: SemanticRole,
  name: string,
  extra: { parentId?: string; state?: SemanticState; testId?: string; value?: string } = {},
): SemanticNode {
  return {
    id,
    role,
    name,
    geometry: {
      displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
      intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
      visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
    },
    ...(extra.parentId === undefined ? {} : { parentId: extra.parentId }),
    ...(extra.state === undefined ? {} : { state: extra.state }),
    ...(extra.testId === undefined ? {} : { testId: extra.testId }),
    ...(extra.value === undefined ? {} : { value: {
      status: 'known' as const,
      value: extra.value,
      sensitivity: 'public' as const,
      evidence: {
        source: 'application' as const,
        method: 'declared' as const,
        strength: 'authoritative' as const,
        providerId: 'test-fixture',
      },
    } }),
  };
}

/** Wraps nodes into a snapshot, deriving `rootIds` from the parentless ones. */
export function snapshot(nodes: readonly SemanticNode[], revision = 1): SemanticSnapshot {
  return {
    v: 2,
    sessionId: 'session-1',
    revision,
    columns: 80,
    rows: 24,
    rootIds: nodes.filter((entry) => entry.parentId === undefined).map((entry) => entry.id),
    nodes,
    coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
    hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
  };
}

/** The dialog used by most tests: two buttons, the first one focused. */
export function permissionDialog(): SemanticSnapshot {
  return snapshot([
    node('n1', 'dialog', 'Permission', { state: { modal: true } }),
    node('n2', 'text', 'Allow bash to run?', { parentId: 'n1' }),
    node('n3', 'button', 'Approve', { parentId: 'n1', state: { focused: true } }),
    node('n4', 'button', 'Reject', { parentId: 'n1' }),
  ]);
}
