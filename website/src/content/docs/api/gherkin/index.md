---
title: "@termwright/gherkin"
editUrl: false
---

**@termwright/gherkin**

***

# @termwright/gherkin

`@termwright/gherkin` — physical `.feature` files as native Termwright/Vitest tests.

The package is deliberately a Vite transform plus inert definition values. It
does not install a second scheduler, create generated test files or change how
ordinary `.test.ts` files are discovered.

## Interfaces

- [GeneratedGherkinImports](interfaces/generatedgherkinimports/)
- [GherkinContext](interfaces/gherkincontext/)
- [GherkinPluginOptions](interfaces/gherkinpluginoptions/)
- [GherkinResource](interfaces/gherkinresource/)
- [GherkinScenario](interfaces/gherkinscenario/)
- [HookDefinition](interfaces/hookdefinition/)
- [HookDefinitionOptions](interfaces/hookdefinitionoptions/)
- [ParameterTypeDefinition](interfaces/parametertypedefinition/)
- [ParameterTypeOptions](interfaces/parametertypeoptions/)
- [StepDefinition](interfaces/stepdefinition/)

## Type Aliases

- [GherkinDefinition](type-aliases/gherkindefinition/)
- [GherkinDefinitions](type-aliases/gherkindefinitions/)
- [GherkinStepArgument](type-aliases/gherkinstepargument/)
- [GherkinWorld](type-aliases/gherkinworld/)
- [HookDefinitionBody](type-aliases/hookdefinitionbody/)
- [StepDefinitionBody](type-aliases/stepdefinitionbody/)
- [StepKeyword](type-aliases/stepkeyword/)

## Variables

- [GHERKIN\_TAGS\_ENV](variables/gherkin_tags_env/)

## Functions

- [After](functions/after/)
- [Before](functions/before/)
- [composeTagExpressions](functions/composetagexpressions/)
- [defineParameterType](functions/defineparametertype/)
- [defineSteps](functions/definesteps/)
- [gherkinPlugin](functions/gherkinplugin/)
- [Given](functions/given/)
- [Step](functions/step/)
- [Then](functions/then/)
- [When](functions/when/)
