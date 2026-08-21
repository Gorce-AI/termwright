import type { TermwrightFixtures } from '@termwright/test';

/** The mutable state shared by every step in one Scenario or Outline row. */
export type GherkinWorld = Record<string, unknown>;

/** Source identity of the native Vitest case currently being executed. */
export interface GherkinScenario {
  readonly feature: string;
  readonly name: string;
  readonly uri: string;
  readonly line: number;
  readonly tags: readonly string[];
}

/** Termwright's native fixtures plus Gherkin's per-scenario world and metadata. */
export interface GherkinContext extends TermwrightFixtures {
  readonly expect: typeof import('vitest')['expect'];
  readonly world: GherkinWorld;
  readonly scenario: GherkinScenario;
  /** Registers test-scoped cleanup. Cleanups run in reverse order after `After` hooks. */
  readonly defer: (cleanup: () => unknown | Promise<unknown>) => void;
  /** Registers a closeable/disposable resource and returns it unchanged. */
  readonly use: <T extends GherkinResource>(resource: T) => T;
}

export interface GherkinResource {
  close?: () => unknown | Promise<unknown>;
  dispose?: () => unknown | Promise<unknown>;
  [Symbol.dispose]?: () => unknown;
  [Symbol.asyncDispose]?: () => unknown | Promise<unknown>;
}

/** A DocString or DataTable attached to a Gherkin step. */
export type GherkinStepArgument = string | readonly (readonly string[])[];

/** Body of a Given/When/Then definition. Captures follow the context argument. */
export type StepDefinitionBody = (
  context: GherkinContext,
  ...captures: readonly unknown[]
) => unknown | Promise<unknown>;

export type StepKeyword = 'Given' | 'When' | 'Then' | 'Step';

/** Public, inert definition value exported by a paired glue module. */
export interface StepDefinition {
  readonly type: 'step';
  readonly keyword: StepKeyword;
  readonly expression: string | RegExp;
  readonly body: StepDefinitionBody;
}

export type HookDefinitionBody = (context: GherkinContext) => unknown | Promise<unknown>;

export interface HookDefinitionOptions {
  /** Cucumber tag expression selecting scenarios for this hook. */
  readonly tags?: string;
}

export interface HookDefinition {
  readonly type: 'hook';
  readonly phase: 'before' | 'after';
  readonly options: HookDefinitionOptions;
  readonly body: HookDefinitionBody;
}

/** Options accepted by {@link defineParameterType}. */
export interface ParameterTypeOptions<T> {
  readonly name: string;
  readonly regexp: RegExp | readonly RegExp[];
  readonly transformer: (...groups: readonly string[]) => T | Promise<T>;
  readonly useForSnippets?: boolean;
  readonly preferForRegexpMatch?: boolean;
}

/** An inert custom parameter type, resolved with the same nearest-scope rules. */
export interface ParameterTypeDefinition<T = unknown> {
  readonly type: 'parameter';
  readonly options: ParameterTypeOptions<T>;
}

export type GherkinDefinition = StepDefinition | ParameterTypeDefinition | HookDefinition;
export type GherkinDefinitions = readonly GherkinDefinition[];

function definition(keyword: StepKeyword, expression: string | RegExp, body: StepDefinitionBody): StepDefinition {
  if (typeof expression === 'string' && expression.length === 0) {
    throw new TypeError(`${keyword} expression must not be empty`);
  }
  return Object.freeze({ type: 'step', keyword, expression, body });
}

/** Declares a Given definition without registering process-global state. */
export function Given(expression: string | RegExp, body: StepDefinitionBody): StepDefinition {
  return definition('Given', expression, body);
}

/** Declares a When definition without registering process-global state. */
export function When(expression: string | RegExp, body: StepDefinitionBody): StepDefinition {
  return definition('When', expression, body);
}

/** Declares a Then definition without registering process-global state. */
export function Then(expression: string | RegExp, body: StepDefinitionBody): StepDefinition {
  return definition('Then', expression, body);
}

/** Declares a keyword-neutral definition. */
export function Step(expression: string | RegExp, body: StepDefinitionBody): StepDefinition {
  return definition('Step', expression, body);
}

/** Runs before each matching Scenario or Outline row selected by this glue scope. */
export function Before(body: HookDefinitionBody): HookDefinition;
export function Before(options: HookDefinitionOptions, body: HookDefinitionBody): HookDefinition;
export function Before(
  optionsOrBody: HookDefinitionOptions | HookDefinitionBody,
  body?: HookDefinitionBody,
): HookDefinition {
  const options = typeof optionsOrBody === 'function' ? {} : optionsOrBody;
  const resolvedBody = typeof optionsOrBody === 'function' ? optionsOrBody : body;
  if (resolvedBody === undefined) throw new TypeError('Before() needs a hook body');
  return Object.freeze({ type: 'hook', phase: 'before', options: Object.freeze({ ...options }), body: resolvedBody });
}

/** Runs after each matching Scenario or Outline row, including failed scenarios. */
export function After(body: HookDefinitionBody): HookDefinition;
export function After(options: HookDefinitionOptions, body: HookDefinitionBody): HookDefinition;
export function After(
  optionsOrBody: HookDefinitionOptions | HookDefinitionBody,
  body?: HookDefinitionBody,
): HookDefinition {
  const options = typeof optionsOrBody === 'function' ? {} : optionsOrBody;
  const resolvedBody = typeof optionsOrBody === 'function' ? optionsOrBody : body;
  if (resolvedBody === undefined) throw new TypeError('After() needs a hook body');
  return Object.freeze({ type: 'hook', phase: 'after', options: Object.freeze({ ...options }), body: resolvedBody });
}

/** Declares a custom Cucumber Expression parameter type. */
export function defineParameterType<T>(options: ParameterTypeOptions<T>): ParameterTypeDefinition<T> {
  if (options.name.length === 0) throw new TypeError('parameter type name must not be empty');
  return Object.freeze({ type: 'parameter', options: Object.freeze({ ...options }) });
}

/**
 * Creates the default export of a paired glue module.
 *
 * Definitions are data, not global registrations. This is what lets two feature
 * files load different nearest-scope definitions safely in the same Vitest worker.
 */
export function defineSteps(...definitions: readonly GherkinDefinition[]): GherkinDefinitions {
  return Object.freeze([...definitions]);
}
