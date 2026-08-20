import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
  RegularExpression,
  type Argument,
  type Expression,
} from '@cucumber/cucumber-expressions';
import type {
  GherkinContext,
  GherkinDefinitions,
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
  run(step: RuntimeStep, context: GherkinContext): Promise<void>;
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

/** Compiles already-paired glue into a feature-local step resolver. */
export function createGherkinRuntime(imported: readonly ImportedGlue[]): GherkinRuntime {
  const glue = [...imported].sort((left, right) =>
    left.tier - right.tier || left.path.localeCompare(right.path));
  for (const module of glue) validateDefinitions(module);
  const definitions = compiledSteps(glue, parameterRegistry(glue));

  return Object.freeze({
    async run(step: RuntimeStep, context: GherkinContext): Promise<void> {
      let activeTier: number | undefined;
      const matches: StepMatch[] = [];
      for (const located of definitions) {
        if (activeTier !== undefined && located.tier > activeTier) break;
        const args = located.expression.match(step.text);
        if (args === null) continue;
        activeTier = located.tier;
        matches.push({ located, arguments: args });
      }

      if (matches.length === 0) {
        throw new Error(`Undefined Gherkin step ${JSON.stringify(step.text)}`);
      }
      if (matches.length > 1) throw ambiguity(step, matches);

      const match = matches[0]!;
      const captures = await Promise.all(
        match.arguments.map((argument) => argument.getValue(context.world)),
      );
      const values = step.argument === undefined
        ? captures
        : [...captures, step.argument];
      await match.located.definition.body(context, ...values);
    },
  });
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
