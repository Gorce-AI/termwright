/**
 * Turning a tool's target arguments into a driver `Locator`.
 *
 * This module owns *no* matching logic: it picks the driver locator factory the
 * arguments describe and hands everything else — strictness, waiting, staleness,
 * candidate diagnostics — to `@termwright/driver`.
 */
import type { Locator, TerminalHarness } from '@termwright/driver';
import { McpError, usageError } from './errors.js';
import { definedOnly } from './objects.js';
import type { Loose } from './objects.js';
import { parseRef } from './format.js';
import type { SemanticRole, SemanticState } from './model.js';

/**
 * The target arguments every acting tool accepts. Exactly one selector wins.
 *
 * Optional fields admit an explicit `undefined` because they arrive straight
 * from zod-parsed arguments, where an absent key is present-and-undefined.
 */
export interface TargetInput {
  /** A ref from a previous snapshot, e.g. `n8@42`. */
  readonly ref?: string | undefined;
  /** The Textual-style CSS dialect, e.g. `dialog button#approve:focused`. */
  readonly selector?: string | undefined;
  readonly role?: SemanticRole | undefined;
  /** Accessible name; `/…/flags` is read as a regular expression. */
  readonly name?: string | undefined;
  readonly testId?: string | undefined;
  /** Visible text (grid matching when there is no semantic tree). */
  readonly text?: string | undefined;
  /** Label text (`labelledBy`, else name). */
  readonly label?: string | undefined;
  readonly exact?: boolean | undefined;
  readonly state?: Readonly<Loose<SemanticState>> | undefined;
  /** Zero-based pick among multiple matches; strict mode applies when omitted. */
  readonly nth?: number | undefined;
}

const REGEX_LITERAL = /^\/(.*)\/([gimsuy]*)$/su;

/**
 * Reads `/pattern/flags` as a RegExp and anything else as a literal string —
 * the same convention the YAML snapshot format uses for names.
 */
export function textOrRegExp(value: string): string | RegExp {
  const match = REGEX_LITERAL.exec(value);
  if (match === null) return value;
  try {
    return new RegExp(match[1] ?? '', match[2] ?? '');
  } catch (error) {
    throw usageError(
      `invalid regular expression ${JSON.stringify(value)}: ${error instanceof Error ? error.message : String(error)}`,
      'quote a literal string, or fix the /pattern/flags form',
    );
  }
}

/** True when the input names no target at all. */
export function hasTarget(input: TargetInput): boolean {
  return (
    input.ref !== undefined ||
    input.selector !== undefined ||
    input.role !== undefined ||
    input.testId !== undefined ||
    input.text !== undefined ||
    input.label !== undefined
  );
}

/**
 * Resolves a `ref` against the *current* semantic tree.
 *
 * Refs bind their revision (driver contract): a ref minted at semantic revision
 * 42 is only usable while 42 is the live revision. Anything older fails as
 * `stale-snapshot` — the same failure the driver would raise — so agents learn
 * to re-snapshot rather than to act on a screen that has moved on.
 */
function locatorForRef(harness: TerminalHarness, ref: string): Locator {
  const parsed = parseRef(ref);
  if (parsed === null) {
    throw usageError(`ref ${JSON.stringify(ref)} is not of the form n8@42`);
  }
  const tree = harness.semanticTree();
  if (tree === null) {
    throw new McpError(
      'unsupported-action',
      `ref ${ref} cannot be used: this session has no semantic tree`,
      'target by text or by grid coordinates instead',
    );
  }
  if (tree.revision !== parsed.revision) {
    throw new McpError(
      'stale-snapshot',
      `ref ${ref} was minted at semantic revision ${parsed.revision}; the live revision is ${tree.revision}`,
      'call terminal.snapshot or terminal.capture_since and use the fresh refs',
    );
  }
  const node = tree.nodes.find((candidate) => candidate.id === parsed.nodeId);
  if (node === undefined) {
    throw new McpError(
      'stale-snapshot',
      `ref ${ref} no longer exists at semantic revision ${tree.revision}`,
      'call terminal.snapshot and use the fresh refs',
    );
  }
  if (node.testId !== undefined) return harness.getByTestId(node.testId);
  return harness.getByRole(node.role, definedOnly({ name: node.name, exact: true }));
}

/**
 * Builds the locator described by `input`. Precedence is `ref`, `selector`,
 * `testId`, `role`, `label`, `text` — the order from most to least specific.
 */
export function buildLocator(harness: TerminalHarness, input: TargetInput): Locator {
  let locator: Locator;
  if (input.ref !== undefined) {
    locator = locatorForRef(harness, input.ref);
  } else if (input.selector !== undefined) {
    locator = harness.locator(input.selector);
  } else if (input.testId !== undefined) {
    locator = harness.getByTestId(input.testId);
  } else if (input.role !== undefined) {
    locator = harness.getByRole(
      input.role,
      definedOnly({
        name: input.name === undefined ? undefined : textOrRegExp(input.name),
        exact: input.exact,
        state: input.state === undefined ? undefined : definedOnly(input.state),
      }),
    );
  } else if (input.label !== undefined) {
    locator = harness.getByLabel(textOrRegExp(input.label), definedOnly({ exact: input.exact }));
  } else if (input.text !== undefined) {
    locator = harness.getByText(textOrRegExp(input.text), definedOnly({ exact: input.exact }));
  } else {
    throw usageError(
      'no target given',
      'pass one of ref, selector, testId, role (+name), label or text',
    );
  }
  return input.nth === undefined ? locator : locator.nth(input.nth);
}
