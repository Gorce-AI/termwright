/**
 * Parser for the YAML snapshot format (`/CONTRACTS.md` §YAML snapshots).
 *
 * An expected snapshot is a *pattern*, not a document: omitted children mean
 * "don't care", an omitted name matches any name, and `[flags]` asserts only
 * the flags listed. Parsing therefore produces {@link NodePattern}s rather than
 * semantic nodes.
 */

import { parse as parseYaml } from 'yaml';
import { SEMANTIC_ROLES, type SemanticRole, type SemanticState } from '@termwright/protocol';
import { normalizeName } from './yaml-serialize.js';

/** How a pattern constrains a node's accessible name. */
export interface NameMatcher {
  readonly kind: 'literal' | 'regex';
  /** Original text, for error messages. */
  readonly source: string;
  /** Tests an already normalized name. */
  test(name: string): boolean;
}

/** One entry of a `[…]` flag list. */
export interface FlagAssertion {
  readonly key: keyof SemanticState;
  /** `!focused` asserts the state is not set. */
  readonly negated: boolean;
  /** Present for `key=value` entries; absent for a bare boolean flag. */
  readonly value?: string;
  readonly source: string;
}

/** One expected node. */
export interface NodePattern {
  /**
   * `*` matches any role. It must be written quoted (`- '* "Save"'`), because
   * a bare `*` opens a YAML alias.
   */
  readonly role: SemanticRole | '*';
  readonly name?: NameMatcher;
  readonly flags: readonly FlagAssertion[];
  /** `undefined` means the children are not constrained at all. */
  readonly children?: readonly NodePattern[];
  /** The head as written, e.g. `button "Approve" [focused]`. */
  readonly head: string;
}

const STATE_KEYS: ReadonlySet<string> = new Set<keyof SemanticState>([
  'disabled', 'focused', 'selected', 'checked', 'expanded', 'modal', 'busy',
  'hidden', 'readonly', 'multiline', 'orientation', 'level', 'positionInSet',
  'setSize', 'scrollOffset', 'scrollExtent',
]);

const HEAD =
  /^(?<role>[a-zA-Z]+|\*)(?:\s+(?<name>"(?:[^"\\]|\\.)*"|\/(?:[^/\\]|\\.)*\/[a-z]*))?(?:\s*\[(?<flags>[^\]]*)\])?\s*$/u;

/**
 * Parses an expected snapshot.
 *
 * @throws TypeError with the offending line when the text is not a valid
 * snapshot pattern — a broken expectation must fail loudly rather than silently
 * matching everything.
 *
 * @example
 * ```ts
 * const patterns = parseSemanticSnapshot(`
 *   - dialog "Permission" [modal]:
 *       - button /^Appr/
 * `);
 * ```
 */
export function parseSemanticSnapshot(text: string): readonly NodePattern[] {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    throw new TypeError(`invalid semantic snapshot: ${(error as Error).message}`);
  }
  if (document === null || document === undefined) return [];
  return parseList(document, '');
}

function parseList(value: unknown, path: string): readonly NodePattern[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `invalid semantic snapshot${path === '' ? '' : ` at ${path}`}: expected a list of nodes, received ${describe(value)}`,
    );
  }
  return value.map((item, index) => parseItem(item, `${path}[${index}]`));
}

function parseItem(item: unknown, path: string): NodePattern {
  if (typeof item === 'string') return parseNodeHead(item, path);
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const entries = Object.entries(item as Record<string, unknown>);
    const entry = entries[0];
    if (entries.length !== 1 || entry === undefined) {
      throw new TypeError(`invalid semantic snapshot at ${path}: a node must carry exactly one head`);
    }
    const [head, children] = entry;
    const parsed = parseNodeHead(head, path);
    if (children === null) return parsed;
    return { ...parsed, children: parseList(children, path) };
  }
  throw new TypeError(`invalid semantic snapshot at ${path}: expected a node, received ${describe(item)}`);
}

/** Parses a single head such as `button "Approve" [focused,!disabled]`. */
export function parseNodeHead(head: string, path = ''): NodePattern {
  const at = path === '' ? '' : ` at ${path}`;
  const match = HEAD.exec(head.trim());
  const groups = match?.groups;
  if (groups === undefined) {
    throw new TypeError(
      `invalid semantic snapshot node${at}: ${JSON.stringify(head)}; expected 'role "name" [flags]'`,
    );
  }
  const role = groups['role'] as SemanticRole | '*';
  if (role !== '*' && !(SEMANTIC_ROLES as readonly string[]).includes(role)) {
    throw new TypeError(`unknown role ${JSON.stringify(role)}${at}; see SEMANTIC_ROLES in @termwright/protocol`);
  }
  const name = groups['name'];
  return {
    role,
    ...(name === undefined ? {} : { name: parseName(name, at) }),
    flags: parseFlags(groups['flags'], at),
    head: head.trim(),
  };
}

function parseName(source: string, at: string): NameMatcher {
  if (source.startsWith('/')) {
    const end = source.lastIndexOf('/');
    const body = source.slice(1, end);
    const flags = source.slice(end + 1);
    let regex: RegExp;
    try {
      regex = new RegExp(body, flags.includes('u') ? flags : `${flags}u`);
    } catch (error) {
      throw new TypeError(`invalid name pattern ${source}${at}: ${(error as Error).message}`);
    }
    return { kind: 'regex', source, test: (value) => regex.test(value) };
  }
  const literal = normalizeName(JSON.parse(source) as string);
  return { kind: 'literal', source, test: (value) => value === literal };
}

function parseFlags(source: string | undefined, at: string): readonly FlagAssertion[] {
  if (source === undefined) return [];
  const flags: FlagAssertion[] = [];
  for (const raw of source.split(',')) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    const negated = entry.startsWith('!');
    const body = negated ? entry.slice(1).trim() : entry;
    const eq = body.indexOf('=');
    const key = (eq === -1 ? body : body.slice(0, eq)).trim();
    if (!STATE_KEYS.has(key)) {
      throw new TypeError(`unknown state flag ${JSON.stringify(key)}${at}; see SemanticState in @termwright/protocol`);
    }
    const value = eq === -1 ? undefined : body.slice(eq + 1).trim();
    if (value !== undefined && negated) {
      throw new TypeError(`flag ${JSON.stringify(entry)}${at} cannot be both negated and compared to a value`);
    }
    flags.push({ key: key as keyof SemanticState, negated, ...(value === undefined ? {} : { value }), source: entry });
  }
  return flags;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}
