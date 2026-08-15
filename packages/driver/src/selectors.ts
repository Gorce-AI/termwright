/**
 * Locator queries and the Textual-style CSS dialect that produces them.
 *
 * Two query kinds share one engine:
 *
 * - {@link SemanticQuery} — evaluated against the latest accepted semantic
 *   tree: a descendant chain of compound steps (`dialog button.primary:focused`);
 * - {@link GenericQuery} — evaluated against the grid when no semantic tree
 *   exists (or when style predicates are requested), yielding rectangles and
 *   never inventing roles.
 */
import type { Rect, SemanticRole, SemanticState } from '@termwright/protocol';
import type { CellAttributes } from './api.js';
import { UnsupportedActionError } from './errors.js';

/** How a piece of text is compared. */
export type TextMatcher =
  | { readonly kind: 'exact'; readonly text: string }
  | { readonly kind: 'substring'; readonly text: string }
  | { readonly kind: 'regex'; readonly source: RegExp };

/** One compound selector in a descendant chain. */
export interface SemanticStep {
  readonly role?: SemanticRole;
  readonly testId?: string;
  readonly classes: readonly string[];
  readonly name?: TextMatcher;
  /** Matches against `name`, `value` and the labels a node is labelled by. */
  readonly text?: TextMatcher;
  /** Matches against the node's computed label (`labelledBy`, else `name`). */
  readonly label?: TextMatcher;
  readonly state: Readonly<Partial<SemanticState>>;
}

/** A descendant chain evaluated against the semantic tree. */
export interface SemanticQuery {
  readonly kind: 'semantic';
  readonly steps: readonly SemanticStep[];
  /** Human-readable form used in diagnostics. */
  readonly description: string;
}

/** Style predicates for generic grid matching. */
export interface StylePredicates {
  readonly fg?: string;
  readonly bg?: string;
  readonly attributes?: Readonly<Partial<CellAttributes>>;
}

/** A grid query: literal or regex text plus optional style predicates. */
export interface GenericQuery {
  readonly kind: 'generic';
  readonly text: TextMatcher;
  /** 1-based selection among all matches; strict mode applies when omitted. */
  readonly occurrence?: number;
  readonly style?: StylePredicates;
  readonly description: string;
}

/** A ref parsed back into the thing it identifies. */
export type ParsedRef =
  | { readonly kind: 'node'; readonly nodeId: string; readonly revision: number }
  | { readonly kind: 'rect'; readonly rect: Rect; readonly revision: number };

/**
 * A query that names one already-identified target. Unlike a re-query by role
 * and name, a ref stays unambiguous when two nodes look alike.
 */
export interface RefQuery {
  readonly kind: 'ref';
  readonly ref: ParsedRef;
  readonly description: string;
}

/** Anything a {@link Locator} can be built from. */
export type LocatorQuery = SemanticQuery | GenericQuery | RefQuery;

/** Matches `grid:{row},{column},{width},{height}@{screenRevision}`. */
const GRID_REF = /^grid:(\d+),(\d+),(\d+),(\d+)@(\d+)$/u;

/** Matches `{nodeId}@{semanticRevision}`; node ids never contain '@'. */
const NODE_REF = /^([^@\s]+)@(\d+)$/u;

/**
 * Parses a ref minted by `ResolvedTarget.ref`. Returns `null` for anything
 * that is not a ref — callers turn that into a typed error with context.
 */
export function parseRef(ref: string): ParsedRef | null {
  const grid = GRID_REF.exec(ref);
  if (grid !== null) {
    const [, row, column, width, height, revision] = grid;
    return {
      kind: 'rect',
      rect: Object.freeze({
        row: Number(row),
        column: Number(column),
        width: Number(width),
        height: Number(height),
      }),
      revision: Number(revision),
    };
  }
  const node = NODE_REF.exec(ref);
  if (node === null) return null;
  const [, nodeId, revision] = node;
  if (nodeId === undefined || nodeId.startsWith('grid:')) return null;
  return { kind: 'node', nodeId, revision: Number(revision) };
}

/** Builds the query behind `locatorForRef`. */
export function refQuery(ref: ParsedRef): RefQuery {
  const description =
    ref.kind === 'node'
      ? `locatorForRef(${JSON.stringify(`${ref.nodeId}@${ref.revision}`)})`
      : `locatorForRef(${JSON.stringify(`grid:${ref.rect.row},${ref.rect.column},${ref.rect.width},${ref.rect.height}@${ref.revision}`)})`;
  return { kind: 'ref', ref, description };
}

const ROLES: ReadonlySet<string> = new Set<SemanticRole>([
  'application',
  'region',
  'dialog',
  'alert',
  'status',
  'list',
  'listitem',
  'menu',
  'menuitem',
  'button',
  'checkbox',
  'radio',
  'tab',
  'textbox',
  'heading',
  'text',
  'progressbar',
  'separator',
  'scrollbar',
  'table',
  'row',
  'cell',
  'generic',
]);

/** Pseudo-classes recognized by the CSS dialect, mapped to state flags. */
const PSEUDO_STATES: Readonly<Record<string, keyof SemanticState>> = Object.freeze({
  focused: 'focused',
  disabled: 'disabled',
  selected: 'selected',
  checked: 'checked',
  expanded: 'expanded',
  modal: 'modal',
  busy: 'busy',
  hidden: 'hidden',
  readonly: 'readonly',
});

function syntaxError(selector: string, detail: string): never {
  throw new UnsupportedActionError(`cannot parse selector ${JSON.stringify(selector)}: ${detail}`, {
    semanticTree: true,
    suggestion:
      "the CSS dialect supports 'role', '#testId', '.class', ':focused', ':disabled', ':selected', " +
      "':checked', ':expanded', ':modal', ':busy', ':hidden', ':readonly' and descendant combinators",
  });
}

/** Builds a {@link TextMatcher} from the `string | RegExp` public API shape. */
export function textMatcher(value: string | RegExp, exact = false): TextMatcher {
  if (value instanceof RegExp) return { kind: 'regex', source: value };
  return exact ? { kind: 'exact', text: value } : { kind: 'substring', text: value };
}

/** Applies a matcher; comparisons are whitespace-trimmed, substrings case-insensitive. */
export function matchesText(value: string | undefined, matcher: TextMatcher): boolean {
  if (value === undefined) return false;
  switch (matcher.kind) {
    case 'exact':
      return value.trim() === matcher.text.trim();
    case 'substring':
      return value.trim().toLowerCase().includes(matcher.text.trim().toLowerCase());
    case 'regex': {
      // A shared RegExp with /g keeps lastIndex between calls; test on a clone.
      const clone = new RegExp(matcher.source.source, matcher.source.flags.replace('g', ''));
      return clone.test(value);
    }
  }
}

/** Renders a matcher the way it appears in diagnostics. */
export function describeMatcher(matcher: TextMatcher): string {
  switch (matcher.kind) {
    case 'exact':
      return JSON.stringify(matcher.text);
    case 'substring':
      return `~${JSON.stringify(matcher.text)}`;
    case 'regex':
      return String(matcher.source);
  }
}

/**
 * Parses the Textual-style CSS dialect into a {@link SemanticQuery}.
 *
 * @example
 * ```ts
 * parseSelector('dialog button.primary:focused');
 * parseSelector('#confirm-button');
 * ```
 */
export function parseSelector(selector: string): SemanticQuery {
  const parts = selector.trim().split(/\s+/u).filter((part) => part.length > 0);
  if (parts.length === 0) syntaxError(selector, 'selector is empty');
  const steps = parts.map((part) => parseCompound(selector, part));
  return { kind: 'semantic', steps, description: selector.trim() };
}

function parseCompound(selector: string, compound: string): SemanticStep {
  const classes: string[] = [];
  const state: Partial<SemanticState> = {};
  let role: SemanticRole | undefined;
  let testId: string | undefined;

  const tokens = compound.match(/^[A-Za-z][A-Za-z0-9-]*|[#.:][A-Za-z0-9_-]+/gu) ?? [];
  const consumed = tokens.join('');
  if (consumed !== compound) {
    syntaxError(selector, `unexpected characters in ${JSON.stringify(compound)}`);
  }

  for (const token of tokens) {
    const head = token[0];
    const body = token.slice(1);
    if (head === '#') {
      if (testId !== undefined) syntaxError(selector, 'more than one #testId in a compound selector');
      testId = body;
    } else if (head === '.') {
      classes.push(body);
    } else if (head === ':') {
      const flag = PSEUDO_STATES[body.toLowerCase()];
      if (flag === undefined) syntaxError(selector, `unknown pseudo-class :${body}`);
      Object.assign(state, { [flag]: true });
    } else {
      if (role !== undefined) syntaxError(selector, 'more than one role in a compound selector');
      if (!ROLES.has(token)) syntaxError(selector, `unknown role ${JSON.stringify(token)}`);
      role = token as SemanticRole;
    }
  }

  return {
    ...(role !== undefined ? { role } : {}),
    ...(testId !== undefined ? { testId } : {}),
    classes: Object.freeze(classes),
    state: Object.freeze(state),
  };
}

/** Builds the single-step query behind `getByRole`. */
export function roleQuery(
  role: SemanticRole,
  name: TextMatcher | undefined,
  state: Readonly<Partial<SemanticState>>,
): SemanticQuery {
  const description = `getByRole(${JSON.stringify(role)}${name === undefined ? '' : `, name=${describeMatcher(name)}`})`;
  return {
    kind: 'semantic',
    steps: [
      {
        role,
        classes: Object.freeze([]),
        ...(name !== undefined ? { name } : {}),
        state,
      },
    ],
    description,
  };
}

/** Builds the single-step query behind `getByTestId`. */
export function testIdQuery(testId: string): SemanticQuery {
  return {
    kind: 'semantic',
    steps: [{ testId, classes: Object.freeze([]), state: Object.freeze({}) }],
    description: `getByTestId(${JSON.stringify(testId)})`,
  };
}

/** Builds the single-step query behind `getByLabel`. */
export function labelQuery(label: TextMatcher): SemanticQuery {
  return {
    kind: 'semantic',
    steps: [{ label, classes: Object.freeze([]), state: Object.freeze({}) }],
    description: `getByLabel(${describeMatcher(label)})`,
  };
}

/** Builds the single-step semantic query behind `getByText`. */
export function textQuery(text: TextMatcher): SemanticQuery {
  return {
    kind: 'semantic',
    steps: [{ text, classes: Object.freeze([]), state: Object.freeze({}) }],
    description: `getByText(${describeMatcher(text)})`,
  };
}

/** Builds the grid query behind `getByText` in generic sessions. */
export function gridQuery(
  text: TextMatcher,
  occurrence: number | undefined,
  style: StylePredicates | undefined,
): GenericQuery {
  return {
    kind: 'generic',
    text,
    ...(occurrence !== undefined ? { occurrence } : {}),
    ...(style !== undefined ? { style } : {}),
    description: `getByText(${describeMatcher(text)})`,
  };
}
