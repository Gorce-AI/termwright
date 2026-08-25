/**
 * Turning a tool's target arguments into a driver `Locator`.
 *
 * This module owns *no* matching logic: it picks the driver locator factory the
 * arguments describe and hands everything else — strictness, waiting, staleness,
 * candidate diagnostics — to `@termwright/driver`.
 */
import type { AnyLocator, LocatorRef, TerminalHarness } from '@termwright/driver';
import { parseRef } from '@termwright/driver/experimental';
import { usageError } from './errors.js';
import { definedOnly } from './objects.js';
import type { Loose } from './objects.js';
import type { SemanticRole, SemanticState } from './model.js';

/**
 * The target arguments every acting tool accepts. Exactly one selector wins.
 *
 * Optional fields admit an explicit `undefined` because they arrive straight
 * from zod-parsed arguments, where an absent key is present-and-undefined.
 */
export interface TargetInput {
  /** A domain-tagged ref: `semantic:n8@42`, or `screen:1,2,9,1@7`. */
  readonly ref?: string | undefined;
  /** Termwright Semantic Selector Language, e.g. `dialog button#approve:focused`. */
  readonly selector?: string | undefined;
  readonly role?: SemanticRole | undefined;
  /** Accessible name; `/…/flags` is read as a regular expression. */
  readonly name?: string | undefined;
  readonly testId?: string | undefined;
  /** Text carried by a semantic node. Requires a semantic tree. */
  readonly text?: string | undefined;
  /** Text rendered in the physical terminal grid. */
  readonly screenText?: string | undefined;
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
    input.screenText !== undefined ||
    input.label !== undefined
  );
}

/**
 * Builds the locator described by `input`. Precedence is `ref`, `selector`,
 * `testId`, `role`, `label`, `text`, `screenText` — the order from most to least specific.
 *
 * Every branch hands straight to a driver factory; nothing here matches, waits
 * or decides staleness.
 */
export function buildLocator(harness: TerminalHarness, input: TargetInput): AnyLocator {
  let locator: AnyLocator;
  if (input.ref !== undefined) {
    // The driver resolves a ref by node identity and owns its staleness rule,
    // so two nodes with the same name stay distinct. The driver alone decides
    // whether that producer promised stable identity or requires a fresh ref.
    if (parseRef(input.ref) === null) {
      throw usageError('ref must include an explicit locator domain', 'use semantic:<node>@<revision> or screen:<row>,<column>,<width>,<height>@<revision>');
    }
    locator = harness.locatorForRef(input.ref as LocatorRef);
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
  } else if (input.screenText !== undefined) {
    locator = harness.getByScreenText(textOrRegExp(input.screenText), definedOnly({ exact: input.exact }));
  } else {
    throw usageError(
      'no target given',
      'pass one of ref, selector, testId, role (+name), label, text or screenText',
    );
  }
  return input.nth === undefined ? locator : locator.nth(input.nth);
}
