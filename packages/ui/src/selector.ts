/**
 * Selector generation: from a node in a {@link SemanticSnapshot} to the
 * narrowest driver locator that still resolves to exactly that node.
 *
 * This is the inspector's "copy selector" button and the recorder's code
 * generator sharing one implementation, so what the UI shows and what the
 * generated test contains can never drift apart.
 *
 * The rule is *narrowest wins*: the first strategy in the list below that
 * resolves uniquely is the one emitted. Positional strategies (`nth`) come last
 * — they are the ones that break when the app grows a second button.
 *
 * 1. `getByTestId('save')` — an author-supplied id is a promise of stability;
 * 2. `getByRole('button', { name: 'Save' })` — unique in the whole tree;
 * 3. the same, scoped `.within(getByRole('dialog', { name: 'Permission' }))`;
 * 4. `getByText('Save')` for nodes without a role-name identity;
 * 5. anything above plus `.nth(i)` when the tree genuinely holds duplicates.
 *
 * @packageDocumentation
 */

import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';

/** Container roles worth scoping a selector by, most specific first. */
const SCOPE_ROLES = ['dialog', 'menu', 'list', 'table', 'row', 'region', 'application'] as const;

/** Which strategy produced a selector. */
export type SelectorKind = 'testId' | 'role' | 'role-scoped' | 'text' | 'role-index' | 'text-index';

/** A generated selector, ready to display and to paste into a test. */
export interface GeneratedSelector {
  /** The node this selector was generated for. */
  readonly nodeId: string;
  /** Strategy that won. */
  readonly kind: SelectorKind;
  /** Expression without a receiver: `getByRole('button', { name: 'Save' })`. */
  readonly code: string;
  /** Expression with a receiver: `terminal.getByRole('button', …)`. */
  readonly expression: string;
  /**
   * False when even the positional fallback could not isolate the node — the
   * tree contains indistinguishable siblings. The selector is still emitted;
   * the UI marks it as fragile.
   */
  readonly unique: boolean;
}

/** Options for {@link generateSelector}. */
export interface SelectorOptions {
  /**
   * Receiver the expression is prefixed with. Default `terminal` — the name the
   * `@termwright/test` fixture uses in its examples.
   */
  readonly root?: string;
}

/**
 * Generates the narrowest selector resolving to `nodeId`.
 *
 * @param snapshot - the tree the node belongs to.
 * @param nodeId - id of the node to address.
 * @returns the selector, or `undefined` when `nodeId` is not in the snapshot.
 *
 * @example
 * ```ts
 * const selector = generateSelector(snapshot, 'n8');
 * selector?.expression; // "terminal.getByRole('button', { name: 'Approve' })"
 * ```
 */
export function generateSelector(
  snapshot: SemanticSnapshot,
  nodeId: string,
  options: SelectorOptions = {},
): GeneratedSelector | undefined {
  const nodes = snapshot.nodes;
  const target = nodes.find((node) => node.id === nodeId);
  if (target === undefined) return undefined;
  const root = options.root ?? 'terminal';
  const build = (kind: SelectorKind, code: string, unique: boolean): GeneratedSelector => ({
    nodeId,
    kind,
    code,
    expression: `${root}.${code}`,
    unique,
  });

  if (target.testId !== undefined && target.testId !== '') {
    const sameTestId = nodes.filter((node) => node.testId === target.testId);
    const code = `getByTestId(${quote(target.testId)})`;
    if (sameTestId.length === 1) return build('testId', code, true);
    const index = sameTestId.indexOf(target);
    return build('testId', `${code}.nth(${index})`, true);
  }

  const name = target.name;
  if (name !== '') {
    const sameRoleName = nodes.filter((node) => node.role === target.role && node.name === name);
    const code = `getByRole(${quote(target.role)}, { name: ${quote(name)} })`;
    if (sameRoleName.length === 1) return build('role', code, true);

    const scope = findScope(snapshot, target, sameRoleName);
    if (scope !== undefined) {
      const scopeCode = scopeExpression(scope.node, root);
      return build('role-scoped', `${code}.within(${scopeCode})`, true);
    }

    const index = sameRoleName.indexOf(target);
    return build('role-index', `${code}.nth(${index})`, true);
  }

  const text = textOf(target);
  if (text !== '') {
    const sameText = nodes.filter((node) => node.name === '' && textOf(node) === text);
    const code = `getByText(${quote(text)})`;
    if (sameText.length === 1) return build('text', code, true);
    return build('text-index', `${code}.nth(${sameText.indexOf(target)})`, true);
  }

  // Nothing to key on: no test id, no name, no text. Positional only, and the
  // position is the snapshot's node order — fragile by construction.
  const sameRole = nodes.filter((node) => node.role === target.role);
  const index = sameRole.indexOf(target);
  return build('role-index', `getByRole(${quote(target.role)}).nth(${index})`, false);
}

/**
 * Nearest named container ancestor that makes `target` unique among
 * `competitors` (the other nodes sharing its role and name).
 */
function findScope(
  snapshot: SemanticSnapshot,
  target: SemanticNode,
  competitors: readonly SemanticNode[],
): { node: SemanticNode } | undefined {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const ancestor of ancestors(byId, target)) {
    if (ancestor.name === '' && (ancestor.testId ?? '') === '') continue;
    if (!(SCOPE_ROLES as readonly string[]).includes(ancestor.role)) continue;
    const inside = competitors.filter((node) => isDescendant(byId, node, ancestor.id));
    if (inside.length === 1) return { node: ancestor };
  }
  return undefined;
}

function scopeExpression(scope: SemanticNode, root: string): string {
  if (scope.testId !== undefined && scope.testId !== '') {
    return `${root}.getByTestId(${quote(scope.testId)})`;
  }
  return `${root}.getByRole(${quote(scope.role)}, { name: ${quote(scope.name)} })`;
}

function* ancestors(
  byId: ReadonlyMap<string, SemanticNode>,
  node: SemanticNode,
): Generator<SemanticNode> {
  const seen = new Set<string>([node.id]);
  let current = node.parentId === undefined ? undefined : byId.get(node.parentId);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    yield current;
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
}

function isDescendant(
  byId: ReadonlyMap<string, SemanticNode>,
  node: SemanticNode,
  ancestorId: string,
): boolean {
  for (const ancestor of ancestors(byId, node)) {
    if (ancestor.id === ancestorId) return true;
  }
  return false;
}

/** Text a node can be addressed by when it has no accessible name. */
function textOf(node: SemanticNode): string {
  return (node.value?.status === 'known' && node.value.sensitivity === 'public' ? node.value.value : node.description ?? '').trim();
}

/** Single-quoted TypeScript string literal. */
export function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `'${escaped}'`;
}
