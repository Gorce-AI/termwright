/**
 * Matches a parsed YAML snapshot pattern against a live semantic tree.
 *
 * Matching is *partial* by design (`/CONTRACTS.md` §YAML snapshots): expected
 * children are a subsequence of the actual children, so a test asserts the
 * structure it cares about and stays immune to unrelated additions elsewhere in
 * the tree.
 */

import type { SemanticNode, SemanticSnapshot, SemanticState } from '@termwright/protocol';
import { childIndex, describeNode, normalizeName, topLevel } from './yaml-serialize.js';
import type { FlagAssertion, NodePattern } from './yaml-pattern.js';

/** Where and why a snapshot failed to match. */
export interface SnapshotMismatch {
  /** Trail of expected heads down to the failure, e.g. `dialog "X" > button`. */
  readonly path: string;
  /** The expected node head that could not be satisfied. */
  readonly expected: string;
  /** Plain-English explanation of the closest candidate's problem. */
  readonly reason: string;
}

/** Result of {@link matchSemanticSnapshot}. */
export interface SnapshotMatchResult {
  readonly ok: boolean;
  readonly mismatch?: SnapshotMismatch;
}

/** Options for {@link matchSemanticSnapshot}. */
export interface MatchOptions {
  /** Match against this node's subtree instead of the roots. */
  readonly rootId?: string;
  /**
   * With `rootId`, whether that node is itself the top level (default) or only
   * the parent of it — `false` matches the pattern against what is *inside*
   * the node, which is what `{ within }` scoping means.
   */
  readonly includeRoot?: boolean;
  /**
   * Ceiling on node comparisons. Guards the backtracking search against
   * pathological patterns. Default 50 000.
   */
  readonly maxComparisons?: number;
}

interface NodeFailure {
  readonly ok: false;
  readonly reason: string;
  /** Set when the failure came from a nested level. */
  readonly nested?: SnapshotMismatch;
}

type NodeResult = { readonly ok: true } | NodeFailure;

/**
 * Matches `patterns` against `snapshot`.
 *
 * @example
 * ```ts
 * const result = matchSemanticSnapshot(parseSemanticSnapshot(expected), tree);
 * if (!result.ok) console.error(result.mismatch);
 * ```
 */
export function matchSemanticSnapshot(
  patterns: readonly NodePattern[],
  snapshot: SemanticSnapshot,
  options: MatchOptions = {},
): SnapshotMatchResult {
  const children = childIndex(snapshot);
  const roots = topLevel(snapshot, children, options.rootId, options.includeRoot);
  const state = { budget: options.maxComparisons ?? 50_000 };
  return matchLevel(patterns, roots, children, '', state);
}

function matchLevel(
  patterns: readonly NodePattern[],
  nodes: readonly SemanticNode[],
  children: ReadonlyMap<string, SemanticNode[]>,
  trail: string,
  state: { budget: number },
): SnapshotMatchResult {
  if (patterns.length === 0) return { ok: true };
  if (search(patterns, nodes, 0, 0, children, trail, state)) return { ok: true };
  return { ok: false, mismatch: diagnose(patterns, nodes, children, trail, state) };
}

/** Order-preserving subsequence search with backtracking. */
function search(
  patterns: readonly NodePattern[],
  nodes: readonly SemanticNode[],
  pi: number,
  ni: number,
  children: ReadonlyMap<string, SemanticNode[]>,
  trail: string,
  state: { budget: number },
): boolean {
  const pattern = patterns[pi];
  if (pattern === undefined) return true;
  for (let index = ni; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    if (state.budget <= 0) return false;
    state.budget -= 1;
    if (!matchNode(pattern, node, children, trail, state).ok) continue;
    if (search(patterns, nodes, pi + 1, index + 1, children, trail, state)) return true;
  }
  return false;
}

function matchNode(
  pattern: NodePattern,
  node: SemanticNode,
  children: ReadonlyMap<string, SemanticNode[]>,
  trail: string,
  state: { budget: number },
): NodeResult {
  if (pattern.role !== '*' && pattern.role !== node.role) {
    return {
      ok: false,
      reason: `role is ${JSON.stringify(node.role)}, expected ${JSON.stringify(pattern.role)}`,
    };
  }
  if (pattern.name !== undefined) {
    const name = normalizeName(node.name);
    if (!pattern.name.test(name)) {
      return {
        ok: false,
        reason:
          pattern.name.kind === 'regex'
            ? `name ${JSON.stringify(name)} does not match ${pattern.name.source}`
            : `name is ${JSON.stringify(name)}, expected ${pattern.name.source}`,
      };
    }
  }
  for (const flag of pattern.flags) {
    const failure = matchFlag(flag, node.state);
    if (failure !== undefined) return { ok: false, reason: failure };
  }
  if (pattern.children === undefined) return { ok: true };
  const nested = matchLevel(
    pattern.children,
    children.get(node.id) ?? [],
    children,
    trail === '' ? describeNode(node) : `${trail} > ${describeNode(node)}`,
    state,
  );
  if (nested.ok) return { ok: true };
  const mismatch = nested.mismatch;
  return {
    ok: false,
    reason:
      mismatch === undefined
        ? 'children do not match'
        : `children do not match: ${mismatch.reason}`,
    ...(mismatch === undefined ? {} : { nested: mismatch }),
  };
}

function matchFlag(flag: FlagAssertion, state: SemanticState | undefined): string | undefined {
  const actual = state?.[flag.key];
  if (flag.negated) {
    return actual === undefined || actual === false
      ? undefined
      : `flag [!${flag.key}] failed: the node is ${flag.key}`;
  }
  if (flag.value === undefined) {
    return actual === true
      ? undefined
      : `flag [${flag.key}] is not set (actual: ${format(actual)})`;
  }
  return String(actual) === flag.value
    ? undefined
    : `flag [${flag.source}] failed: ${flag.key} is ${format(actual)}`;
}

function format(value: unknown): string {
  return value === undefined ? 'unset' : String(value);
}

/**
 * Explains a failed level: the first expected node with no candidate at all,
 * or — when every node matches individually — the ordering problem.
 */
function diagnose(
  patterns: readonly NodePattern[],
  nodes: readonly SemanticNode[],
  children: ReadonlyMap<string, SemanticNode[]>,
  trail: string,
  state: { budget: number },
): SnapshotMismatch {
  for (const pattern of patterns) {
    let best: NodeFailure | undefined;
    let matched = false;
    for (const node of nodes) {
      const result = matchNode(pattern, node, children, trail, {
        budget: Math.max(state.budget, 1_000),
      });
      if (result.ok) {
        matched = true;
        break;
      }
      if (best === undefined || score(result) > score(best)) best = result;
    }
    if (matched) continue;
    if (best?.nested !== undefined) return best.nested;
    return {
      path: trail,
      expected: pattern.head,
      reason:
        best === undefined
          ? nodes.length === 0
            ? 'no nodes exist at this level'
            : 'no node matches'
          : `closest candidate: ${best.reason}`,
    };
  }
  const first = patterns[0];
  return {
    path: trail,
    expected: first === undefined ? '' : first.head,
    reason: 'every expected node exists, but not in the expected order',
  };
}

/** Ranks near-misses so the reported one is the most informative. */
function score(failure: NodeFailure): number {
  if (failure.reason.startsWith('role')) return 0;
  if (failure.reason.startsWith('name')) return 1;
  if (failure.reason.startsWith('flag')) return 2;
  return 3;
}
