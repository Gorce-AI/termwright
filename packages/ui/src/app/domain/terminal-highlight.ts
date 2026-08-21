import type { Rect, SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import { parseRef } from '../../commands.js';
import type { ExecutionNode } from './model.js';

export interface TerminalHighlight {
  readonly sourceId: string;
  readonly targetRef: string | null;
  readonly revision: number | null;
  readonly role: string | null;
  readonly name: string | null;
  readonly bounds?: Rect;
  readonly reason: string | null;
  readonly pinned: boolean;
}

export function highlightSemanticNode(node: SemanticNode, snapshot: SemanticSnapshot, pinned: boolean): TerminalHighlight {
  const bounds = qualifiedHighlightRect(node);
  return {
    sourceId: `semantic:${snapshot.revision}:${node.id}`,
    targetRef: `${node.id}@${snapshot.revision}`,
    revision: snapshot.revision,
    role: node.role,
    name: node.name,
    ...(bounds === undefined ? {} : { bounds }),
    reason: bounds === undefined ? 'This node has no reliable terminal bounds.' : null,
    pinned,
  };
}

function qualifiedHighlightRect(node: SemanticNode): Rect | undefined {
  const geometry = node.geometry;
  if (geometry.visibleRect.status === 'known') return geometry.visibleRect.value;
  return undefined;
}

export function highlightExecutionTarget(node: ExecutionNode, snapshot: SemanticSnapshot | null, pinned: boolean): TerminalHighlight | null {
  if (node.kind !== 'action' && node.kind !== 'assertion' && node.kind !== 'input') return null;
  if (node.targetIssue !== undefined) return unresolved(node, null, node.targetIssue, pinned);
  if (node.targetRef === undefined) {
    return unresolved(node, null, 'This command did not retain a resolved semantic target.', pinned);
  }
  const parsed = parseRef(node.targetRef);
  if (parsed === null) return unresolved(node, null, `Unsupported target reference: ${node.targetRef}`, pinned);
  if (snapshot === null) return unresolved(node, parsed.revision, `Semantic revision ${parsed.revision} is unavailable.`, pinned);
  if (snapshot.revision !== parsed.revision) {
    return unresolved(node, parsed.revision, `Target revision ${parsed.revision} is not the displayed revision ${snapshot.revision}.`, pinned);
  }
  const target = snapshot.nodes.find((candidate) => candidate.id === parsed.nodeId);
  if (target === undefined) return unresolved(node, parsed.revision, `Target ${parsed.nodeId} is absent from revision ${parsed.revision}.`, pinned);
  return {
    ...highlightSemanticNode(target, snapshot, pinned),
    sourceId: `command:${node.nodeId}`,
    targetRef: node.targetRef,
  };
}

function unresolved(node: ExecutionNode, revision: number | null, reason: string, pinned: boolean): TerminalHighlight {
  return {
    sourceId: `command:${node.nodeId}`,
    targetRef: node.targetRef ?? null,
    revision,
    role: null,
    name: null,
    reason,
    pinned,
  };
}
