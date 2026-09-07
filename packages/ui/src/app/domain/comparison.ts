import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type { TraceOverview } from '../../trace-source.js';

type ComparisonTrace = {
  readonly durationMs: number;
  readonly steps: readonly Pick<
    TraceOverview['steps'][number],
    'stepId' | 'title' | 'parentStepId' | 'castOffset' | 'castEndOffset'
  >[];
};

export interface AlignedStep {
  readonly key: string;
  readonly title: string;
  readonly left: number;
  readonly right: number;
}
export function alignedSteps(
  left: ComparisonTrace,
  right: ComparisonTrace,
): readonly AlignedStep[] {
  const index = (overview: ComparisonTrace) => {
    const byId = new Map(overview.steps.map((step) => [step.stepId, step]));
    const seen = new Map<string, number>();
    return overview.steps.map((step) => {
      const names = [step.title];
      const visited = new Set([step.stepId]);
      let parent = step.parentStepId;
      while (parent !== undefined && !visited.has(parent)) {
        visited.add(parent);
        const node = byId.get(parent);
        if (node === undefined) break;
        names.unshift(node.title);
        parent = node.parentStepId;
      }
      const path = JSON.stringify(names);
      const occurrence = (seen.get(path) ?? 0) + 1;
      seen.set(path, occurrence);
      return {
        key: `${path}:${occurrence}`,
        title: `${names.join(' › ')}${occurrence > 1 ? ` (${occurrence})` : ''}`,
        time: Math.min(step.castEndOffset ?? step.castOffset, overview.durationMs),
      };
    });
  };
  const rhs = new Map(index(right).map((step) => [step.key, step]));
  return index(left).flatMap((step) => {
    const match = rhs.get(step.key);
    return match === undefined
      ? []
      : [{ key: step.key, title: step.title, left: step.time, right: match.time }];
  });
}

export interface SemanticDifference {
  readonly key: string;
  readonly label: string;
  readonly kind: 'added' | 'removed' | 'changed';
  readonly before: string;
  readonly after: string;
}
/** Match stable test IDs first, then unique semantic ancestry. Never compare ephemeral node IDs. */
export function semanticDifferences(
  left: SemanticSnapshot,
  right: SemanticSnapshot,
): { readonly differences: readonly SemanticDifference[]; readonly ambiguous: number } {
  const index = (snapshot: SemanticSnapshot) => {
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const result = new Map<string, SemanticNode[]>();
    for (const node of snapshot.nodes) {
      const path = [[node.role, node.name]];
      const visited = new Set([node.id]);
      let parent = node.parentId;
      while (parent !== undefined && !visited.has(parent)) {
        visited.add(parent);
        const ancestor = byId.get(parent);
        if (ancestor === undefined) break;
        path.unshift([ancestor.role, ancestor.name]);
        parent = ancestor.parentId;
      }
      const key = node.testId ? `testId:${node.testId}` : JSON.stringify(path);
      result.set(key, [...(result.get(key) ?? []), node]);
    }
    return result;
  };
  const a = index(left);
  const b = index(right);
  const differences: SemanticDifference[] = [];
  let ambiguous = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const before = a.get(key) ?? [];
    const after = b.get(key) ?? [];
    if (before.length > 1 || after.length > 1) {
      ambiguous += 1;
      continue;
    }
    const one = before[0];
    const two = after[0];
    const node = two ?? one!;
    const describe = (entry: SemanticNode | undefined) =>
      entry === undefined
        ? '—'
        : stable({
            role: entry.role,
            name: entry.name,
            state: entry.state ?? {},
            geometry: {
              displayed:
                entry.geometry.displayed.status === 'known'
                  ? entry.geometry.displayed.value
                  : entry.geometry.displayed.status,
              visible:
                entry.geometry.visibleRect.status === 'known'
                  ? entry.geometry.visibleRect.value
                  : entry.geometry.visibleRect.status,
            },
          });
    const previous = describe(one);
    const next = describe(two);
    if (previous !== next)
      differences.push({
        key,
        label: `${node.role} · ${node.name || node.testId || 'Unnamed element'}`,
        kind: one === undefined ? 'added' : two === undefined ? 'removed' : 'changed',
        before: previous,
        after: next,
      });
  }
  return { differences, ambiguous };
}
function stable(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry: unknown) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
        : entry,
    2,
  );
}
