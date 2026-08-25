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

/** Termwright's native and project fixtures plus Gherkin's per-scenario state. */
export type GherkinContext<Fixtures extends object = object> = TermwrightFixtures & Fixtures & {
  readonly expect: typeof import('vitest')['expect'];
  readonly world: GherkinWorld;
  readonly scenario: GherkinScenario;
  /** Registers test-scoped cleanup. Cleanups run in reverse order after `After` hooks. */
  readonly defer: (cleanup: () => unknown | Promise<unknown>) => void;
  /** Registers a closeable/disposable resource and returns it unchanged. */
  readonly use: <T extends GherkinResource>(resource: T) => T;
};

export interface GherkinResource {
  close?: () => unknown | Promise<unknown>;
  dispose?: () => unknown | Promise<unknown>;
  [Symbol.dispose]?: () => unknown;
  [Symbol.asyncDispose]?: () => unknown | Promise<unknown>;
}

/** A DocString or DataTable attached to a Gherkin step. */
export type GherkinStepArgument = string | readonly (readonly string[])[];

/** Body of a Given/When/Then definition. Captures follow the context argument. */
export type StepDefinitionBody<Fixtures extends object = object> = (
  context: GherkinContext<Fixtures>,
  ...captures: readonly unknown[]
) => unknown | Promise<unknown>;

export type StepKeyword = 'Given' | 'When' | 'Then' | 'Step';

/** Public, inert definition value exported by a paired glue module. */
export interface StepDefinition<Fixtures extends object = object> {
  readonly type: 'step';
  readonly keyword: StepKeyword;
  readonly expression: string | RegExp;
  readonly body: StepDefinitionBody<Fixtures>;
}

export type HookDefinitionBody<Fixtures extends object = object> = (
  context: GherkinContext<Fixtures>
) => unknown | Promise<unknown>;

export interface HookDefinitionOptions {
  /** Cucumber tag expression selecting scenarios for this hook. */
  readonly tags?: string;
}

export interface HookDefinition<Fixtures extends object = object> {
  readonly type: 'hook';
  readonly phase: 'before' | 'after';
  readonly options: HookDefinitionOptions;
  readonly body: HookDefinitionBody<Fixtures>;
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

export type GherkinDefinition<Fixtures extends object = object> =
  | StepDefinition<Fixtures>
  | ParameterTypeDefinition
  | HookDefinition<Fixtures>;
export type GherkinDefinitions<Fixtures extends object = object> = readonly GherkinDefinition<Fixtures>[];

function definition<Fixtures extends object>(
  keyword: StepKeyword,
  expression: string | RegExp,
  body: StepDefinitionBody<Fixtures>,
): StepDefinition<Fixtures> {
  if (typeof expression === 'string' && expression.length === 0) {
    throw new TypeError(`${keyword} expression must not be empty`);
  }
  return Object.freeze({ type: 'step', keyword, expression, body });
}

/** Declares a Given definition without registering process-global state. */
export function Given<Fixtures extends object = object>(
  expression: string | RegExp,
  body: StepDefinitionBody<Fixtures>,
): StepDefinition<Fixtures> {
  return definition('Given', expression, body);
}

/** Declares a When definition without registering process-global state. */
export function When<Fixtures extends object = object>(
  expression: string | RegExp,
  body: StepDefinitionBody<Fixtures>,
): StepDefinition<Fixtures> {
  return definition('When', expression, body);
}

/** Declares a Then definition without registering process-global state. */
export function Then<Fixtures extends object = object>(
  expression: string | RegExp,
  body: StepDefinitionBody<Fixtures>,
): StepDefinition<Fixtures> {
  return definition('Then', expression, body);
}

/** Declares a keyword-neutral definition. */
export function Step<Fixtures extends object = object>(
  expression: string | RegExp,
  body: StepDefinitionBody<Fixtures>,
): StepDefinition<Fixtures> {
  return definition('Step', expression, body);
}

/** Runs before each matching Scenario or Outline row selected by this glue scope. */
export function Before<Fixtures extends object = object>(body: HookDefinitionBody<Fixtures>): HookDefinition<Fixtures>;
export function Before<Fixtures extends object = object>(
  options: HookDefinitionOptions,
  body: HookDefinitionBody<Fixtures>,
): HookDefinition<Fixtures>;
export function Before<Fixtures extends object = object>(
  optionsOrBody: HookDefinitionOptions | HookDefinitionBody<Fixtures>,
  body?: HookDefinitionBody<Fixtures>,
): HookDefinition<Fixtures> {
  const options = typeof optionsOrBody === 'function' ? {} : optionsOrBody;
  const resolvedBody = typeof optionsOrBody === 'function' ? optionsOrBody : body;
  if (resolvedBody === undefined) throw new TypeError('Before() needs a hook body');
  return Object.freeze({ type: 'hook', phase: 'before', options: Object.freeze({ ...options }), body: resolvedBody });
}

/** Runs after each matching Scenario or Outline row, including failed scenarios. */
export function After<Fixtures extends object = object>(body: HookDefinitionBody<Fixtures>): HookDefinition<Fixtures>;
export function After<Fixtures extends object = object>(
  options: HookDefinitionOptions,
  body: HookDefinitionBody<Fixtures>,
): HookDefinition<Fixtures>;
export function After<Fixtures extends object = object>(
  optionsOrBody: HookDefinitionOptions | HookDefinitionBody<Fixtures>,
  body?: HookDefinitionBody<Fixtures>,
): HookDefinition<Fixtures> {
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
export function defineSteps<Fixtures extends object = object>(
  ...definitions: readonly GherkinDefinition<Fixtures>[]
): GherkinDefinitions<Fixtures> {
  return Object.freeze([...definitions]);
}
