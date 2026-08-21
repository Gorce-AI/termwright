import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
  RegularExpression,
  type Argument,
  type Expression,
} from '@cucumber/cucumber-expressions';
import { parse as parseTagExpression, type Node as TagExpression } from '@cucumber/tag-expressions';
import type {
  GherkinContext,
  GherkinDefinitions,
  GherkinResource,
  GherkinStepArgument,
  ParameterTypeDefinition,
  StepDefinition,
} from './definitions.js';

export interface ImportedGlue {
  readonly path: string;
  readonly tier: number;
  readonly definitions: GherkinDefinitions;
}

export interface RuntimeStep {
  readonly text: string;
  readonly title: string;
  readonly argument?: GherkinStepArgument;
  readonly gherkin?: {
    readonly keyword: string;
    readonly text: string;
    readonly source: { readonly file: string; readonly line: number; readonly column: number };
    readonly background?: boolean;
  };
}

interface LocatedStepDefinition {
  readonly definition: StepDefinition;
  readonly path: string;
  readonly tier: number;
  readonly expression: Expression;
}

interface StepMatch {
  readonly located: LocatedStepDefinition;
  readonly arguments: readonly Argument[];
}

export interface GherkinRuntime {
  before(context: GherkinContext): Promise<void>;
  /** Resolves a step without executing its body or parameter transformers. */
  validate(step: RuntimeStep): void;
  run(step: RuntimeStep, context: GherkinContext): Promise<void>;
  after(context: GherkinContext): Promise<void>;
}

interface CompiledHook {
  readonly body: (context: GherkinContext) => unknown | Promise<unknown>;
  readonly tags?: TagExpression;
}

function compiledHook(definition: Extract<GherkinDefinitions[number], { type: 'hook' }>): CompiledHook {
  const expression = definition.options.tags;
  return {
    body: definition.body,
    ...(expression === undefined || expression.trim() === ''
      ? {}
      : { tags: parseTagExpression(expression) }),
  };
}

function applies(hook: CompiledHook, context: GherkinContext): boolean {
  return hook.tags?.evaluate([...context.scenario.tags]) ?? true;
}

function validateDefinitions(glue: ImportedGlue): void {
  if (!Array.isArray(glue.definitions)) {
    throw new TypeError(`Gherkin glue ${glue.path} must default-export defineSteps(...)`);
  }
}

function parameterRegistry(glue: readonly ImportedGlue[]): ParameterTypeRegistry {
  const registry = new ParameterTypeRegistry();
  const selected = new Map<string, { tier: number; path: string; definition: ParameterTypeDefinition }>();

  for (const module of glue) {
    for (const definition of module.definitions) {
      if (definition.type !== 'parameter') continue;
      const name = definition.options.name;
      const existing = selected.get(name);
      if (existing?.tier === module.tier) {
        throw new Error(
          `Duplicate Gherkin parameter type {${name}} in tier ${module.tier}: ` +
          `${existing.path} and ${module.path}`,
        );
      }
      if (existing !== undefined) continue;
      selected.set(name, { tier: module.tier, path: module.path, definition });
    }
  }

  for (const { definition } of selected.values()) {
    const { name, regexp, transformer, useForSnippets, preferForRegexpMatch } = definition.options;
    registry.defineParameterType(new ParameterType(
      name,
      regexp,
      null,
      transformer,
      useForSnippets,
      preferForRegexpMatch,
    ));
  }
  return registry;
}

function compiledSteps(
  glue: readonly ImportedGlue[],
  registry: ParameterTypeRegistry,
): readonly LocatedStepDefinition[] {
  return glue.flatMap((module) => module.definitions.flatMap((definition) => {
    if (definition.type !== 'step') return [];
    const expression = typeof definition.expression === 'string'
      ? new CucumberExpression(definition.expression, registry)
      : new RegularExpression(definition.expression, registry);
    return [{ definition, path: module.path, tier: module.tier, expression }];
  }));
}

function ambiguity(step: RuntimeStep, matches: readonly StepMatch[]): Error {
  const candidates = matches
    .map(({ located }) => `${located.path}: ${String(located.definition.expression)}`)
    .join('\n  - ');
  return new Error(`Ambiguous Gherkin step ${JSON.stringify(step.text)}:\n  - ${candidates}`);
}

function matchingDefinitions(
  definitions: readonly LocatedStepDefinition[],
  step: RuntimeStep,
): readonly StepMatch[] {
  let activeTier: number | undefined;
  const matches: StepMatch[] = [];
  for (const located of definitions) {
    if (activeTier !== undefined && located.tier > activeTier) break;
    const args = located.expression.match(step.text);
    if (args === null) continue;
    activeTier = located.tier;
    matches.push({ located, arguments: args });
  }
  if (matches.length === 0) throw new Error(`Undefined Gherkin step ${JSON.stringify(step.text)}`);
  if (matches.length > 1) throw ambiguity(step, matches);
  return matches;
}

/** Compiles already-paired glue into a feature-local step resolver. */
export function createGherkinRuntime(imported: readonly ImportedGlue[]): GherkinRuntime {
  const glue = [...imported].sort((left, right) =>
    left.tier - right.tier || left.path.localeCompare(right.path));
  for (const module of glue) validateDefinitions(module);
  const definitions = compiledSteps(glue, parameterRegistry(glue));
  const beforeHooks = glue.flatMap((module) => module.definitions.flatMap((definition) =>
    definition.type === 'hook' && definition.phase === 'before' ? [compiledHook(definition)] : []));
  const afterHooks = glue.toReversed().flatMap((module) => module.definitions.toReversed().flatMap((definition) =>
    definition.type === 'hook' && definition.phase === 'after' ? [compiledHook(definition)] : []));

  return Object.freeze({
    async before(context: GherkinContext): Promise<void> {
      for (const hook of beforeHooks) if (applies(hook, context)) await hook.body(context);
    },
    validate(step: RuntimeStep): void {
      matchingDefinitions(definitions, step);
    },
    async run(step: RuntimeStep, context: GherkinContext): Promise<void> {
      const match = matchingDefinitions(definitions, step)[0]!;
      const captures = await Promise.all(
        match.arguments.map((argument) => argument.getValue(context.world)),
      );
      const values = step.argument === undefined
        ? captures
        : [...captures, step.argument];
      await match.located.definition.body(context, ...values);
    },
    async after(context: GherkinContext): Promise<void> {
      for (const hook of afterHooks) if (applies(hook, context)) await hook.body(context);
    },
  });
}

interface ManagedGherkinContext extends GherkinContext {
  dispose(): Promise<void>;
}

function resourceCleanup(resource: GherkinResource): (() => unknown | Promise<unknown>) {
  if (resource[Symbol.asyncDispose] !== undefined) return () => resource[Symbol.asyncDispose]!();
  if (resource[Symbol.dispose] !== undefined) return () => resource[Symbol.dispose]!();
  if (resource.close !== undefined) return () => resource.close!();
  if (resource.dispose !== undefined) return () => resource.dispose!();
  throw new TypeError('Gherkin context.use() needs a close(), dispose(), Symbol.dispose, or Symbol.asyncDispose resource');
}

/** Adds scenario-scoped resource management without process-global hooks. */
export function createGherkinContext(
  base: Omit<GherkinContext, 'defer' | 'use'>,
): ManagedGherkinContext {
  const cleanups: (() => unknown | Promise<unknown>)[] = [];
  return Object.assign(base, {
    defer(cleanup: () => unknown | Promise<unknown>): void {
      if (typeof cleanup !== 'function') throw new TypeError('Gherkin context.defer() needs a function');
      cleanups.push(cleanup);
    },
    use<T extends GherkinResource>(resource: T): T {
      cleanups.push(resourceCleanup(resource));
      return resource;
    },
    async dispose(): Promise<void> {
      const errors: unknown[] = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Multiple Gherkin scenario cleanups failed');
    },
  });
}

/** Runs hooks, the scenario body, and LIFO resource cleanup as one test lifecycle. */
export async function runGherkinScenario(
  runtime: GherkinRuntime,
  context: ManagedGherkinContext,
  body: () => Promise<void>,
): Promise<void> {
  let failure: unknown;
  try {
    await runtime.before(context);
    await body();
  } catch (error) {
    failure = error;
  }
  try {
    await runtime.after(context);
  } catch (error) {
    failure = failure === undefined
      ? error
      : new AggregateError([failure, error], 'Gherkin scenario and After hook failed');
  }
  try {
    await context.dispose();
  } catch (error) {
    failure = failure === undefined
      ? error
      : new AggregateError([failure, error], 'Gherkin scenario lifecycle failed during cleanup');
  }
  if (failure !== undefined) throw failure;
}

/** Runs one physical Gherkin step through Termwright's native step fixture. */
export async function runGherkinStep(
  runtime: GherkinRuntime,
  context: GherkinContext,
  step: RuntimeStep,
): Promise<void> {
  await context.step(
    step.title,
    () => runtime.run(step, context),
    ...(step.gherkin === undefined ? [] : [{ gherkin: step.gherkin }]),
  );
}
