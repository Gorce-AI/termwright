/**
 * `@termwright/gherkin` — physical `.feature` files as native Termwright/Vitest tests.
 *
 * The package is deliberately a Vite transform plus inert definition values. It
 * does not install a second scheduler, create generated test files or change how
 * ordinary `.test.ts` files are discovered.
 *
 * @packageDocumentation
 */

export {
  After,
  Before,
  Given,
  Step,
  Then,
  When,
  defineParameterType,
  defineSteps,
  type GherkinContext,
  type GherkinDefinition,
  type GherkinDefinitions,
  type GherkinScenario,
  type GherkinStepArgument,
  type GherkinWorld,
  type GherkinResource,
  type HookDefinition,
  type HookDefinitionBody,
  type HookDefinitionOptions,
  type ParameterTypeDefinition,
  type ParameterTypeOptions,
  type StepDefinition,
  type StepDefinitionBody,
  type StepKeyword,
} from './definitions.js';

export {
  GHERKIN_TAGS_ENV,
  composeTagExpressions,
  gherkinPlugin,
  type GeneratedGherkinImports,
  type GherkinPluginOptions,
  type GherkinReservedFixtureName,
} from './plugin.js';
