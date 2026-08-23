import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument, type Pickle, type Scenario, type Step } from '@cucumber/messages';
import { parse as parseTagExpression } from '@cucumber/tag-expressions';
import { SourceMapGenerator, type RawSourceMap } from 'source-map-js';
import { convertPathToPattern, glob } from 'tinyglobby';
import type { HmrContext, Plugin, ResolvedConfig } from 'vite';

const TRANSFORM_MARKER = '/* @termwright/gherkin transformed */';

const DEFAULT_STEP_DEFINITIONS = [
  '[filepath].{ts,tsx,mts}',
  '[filepath]/**/*.{ts,tsx,mts}',
  '[filepart]/step_definitions/**/*.{ts,tsx,mts}',
  'step_definitions/**/*.{ts,tsx,mts}',
] as const;

export interface GherkinPluginOptions {
  /** Directory against which feature paths and pairing templates are resolved. Defaults to Vite's root. */
  readonly featureRoot?: string;
  /** Cypress-compatible `[filepath]` / `[filepart]` glue patterns. */
  readonly stepDefinitions?: readonly string[];
  /**
   * Add physical `.feature` files to Vitest discovery. Used by managed hosts
   * such as `termwright ui`.
   *
   * The feature patterns are derived from the resolved Vitest `test.include`
   * patterns. This deliberately does not widen a narrowly configured suite to
   * every feature below the project root.
   */
  readonly includeFeatures?: boolean;
  /** Module specifiers emitted into transformed feature files. */
  readonly generatedImports?: GeneratedGherkinImports;
  /** Cucumber tag expression selecting Scenario and Outline cases. */
  readonly tags?: string;
}

export interface GeneratedGherkinImports {
  readonly test: string;
  readonly runtime: string;
}

const DEFAULT_GENERATED_IMPORTS: GeneratedGherkinImports = Object.freeze({
  test: '@termwright/test',
  runtime: '@termwright/gherkin/runtime',
});

/**
 * Project a Vitest source include onto physical feature files without
 * broadening its directory scope.
 *
 * `src/**\/*.test.ts` becomes `src/**\/*.feature`; an exact test file only
 * admits sibling features. Explicit feature includes are already authoritative
 * and are left alone. The returned patterns remain relative to Vite's root,
 * just like Vitest's own include list.
 */
export function featureIncludesForVitest(includes: readonly string[]): readonly string[] {
  const projected = new Set<string>();
  for (const rawInclude of includes) {
    const include = posix(rawInclude);
    if (include.startsWith('!') || include === '') continue;
    if (include.toLowerCase().includes('.feature')) continue;

    const slash = include.lastIndexOf('/');
    const directory = slash < 0 ? '' : include.slice(0, slash + 1);
    const basename = slash < 0 ? include : include.slice(slash + 1);
    const hasGlob = /[*?{}()[\]]/u.test(include);

    if (!hasGlob) {
      // Resolved Vitest includes normally name files. An extensionless value is
      // treated as a directory so programmatic configs can still express a
      // source root without accidentally selecting sibling trees.
      projected.add(extname(basename) === ''
        ? `${include.replace(/\/$/u, '')}/**/*.feature`
        : `${directory}*.feature`);
      continue;
    }

    // Preserve every directory glob (the actual configured source scope), but
    // replace the test filename matcher. A literal basename behind a directory
    // glob is still projected because the directory expression is the scope.
    projected.add(`${directory}*.feature`);
  }
  return [...projected];
}

export interface PairingInput {
  readonly featureFile: string;
  readonly featureRoot: string;
  readonly stepDefinitions?: readonly string[];
}

export interface PairedGlue {
  readonly path: string;
  /** Lower tiers are nearer. All files in the first matching tier participate. */
  readonly tier: number;
  readonly scope: 'filepath' | 'filepart' | 'global';
}

export interface TransformFeatureInput {
  readonly source: string;
  readonly uri: string;
  readonly glue: readonly PairedGlue[];
  readonly generatedImports?: GeneratedGherkinImports;
  readonly tags?: string;
}

export interface TransformFeatureResult {
  readonly code: string;
  readonly map: Omit<RawSourceMap, 'version'> & { readonly version: number };
  readonly scenarioLines: readonly number[];
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

function withoutExtension(path: string): string {
  const extension = extname(path);
  return extension.length === 0 ? path : path.slice(0, -extension.length);
}

function fileParts(filepath: string): readonly string[] {
  const parts: string[] = [];
  let current = filepath;
  while (current !== '.' && current.length > 0) {
    parts.push(current);
    const parent = posix(dirname(current));
    current = parent === current ? '.' : parent;
  }
  parts.push('.');
  return parts;
}

function expandTemplate(
  template: string,
  filepath: string,
  parts: readonly string[],
): readonly { pattern: string; tier: number; scope: PairedGlue['scope'] }[] {
  const hasFilepath = template.includes('[filepath]');
  const hasFilepart = template.includes('[filepart]');
  if (hasFilepath && hasFilepart) {
    throw new Error(`Gherkin pairing template cannot combine [filepath] and [filepart]: ${template}`);
  }
  if (hasFilepath) {
    return [{
      pattern: template.replaceAll('[filepath]', convertPathToPattern(filepath)),
      tier: 0,
      scope: 'filepath',
    }];
  }
  if (hasFilepart) {
    return parts.map((part, distance) => ({
      pattern: template.replaceAll('[filepart]', convertPathToPattern(part)),
      tier: 1 + distance,
      scope: 'filepart' as const,
    }));
  }
  return [{ pattern: template, tier: 1 + parts.length, scope: 'global' }];
}

/** Resolves glue deterministically, retaining the nearest tier for files matched more than once. */
export async function resolvePairing(input: PairingInput): Promise<readonly PairedGlue[]> {
  const featureRoot = resolve(input.featureRoot);
  const featureFile = resolve(input.featureFile);
  const relativeFeature = posix(relative(featureRoot, featureFile));
  if (relativeFeature === '..' || relativeFeature.startsWith('../')) {
    throw new Error(`Feature ${featureFile} is outside featureRoot ${featureRoot}`);
  }

  const filepath = withoutExtension(relativeFeature);
  const parts = fileParts(filepath);
  const selected = new Map<string, PairedGlue>();
  const templates = input.stepDefinitions ?? DEFAULT_STEP_DEFINITIONS;

  for (const template of templates) {
    for (const expansion of expandTemplate(template, filepath, parts)) {
      const pattern = isAbsolute(expansion.pattern)
        ? expansion.pattern
        : posix(resolve(featureRoot, expansion.pattern));
      const matches = await glob(pattern, { absolute: true, onlyFiles: true });
      for (const match of matches.sort()) {
        const path = resolve(match);
        const existing = selected.get(path);
        if (existing === undefined || expansion.tier < existing.tier) {
          selected.set(path, { path, tier: expansion.tier, scope: expansion.scope });
        }
      }
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.tier - right.tier || left.path.localeCompare(right.path));
}

function globParent(pattern: string): string {
  let dynamic = -1;
  let escaped = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if ('*?{[('.includes(character)) {
      dynamic = index;
      break;
    }
  }
  if (dynamic === -1) return dirname(pattern);
  const slash = pattern.lastIndexOf('/', dynamic);
  return resolve(slash <= 0 ? '/' : pattern.slice(0, slash));
}

function pairingWatchRoots(input: PairingInput): readonly string[] {
  const featureRoot = resolve(input.featureRoot);
  const featureFile = resolve(input.featureFile);
  const filepath = withoutExtension(posix(relative(featureRoot, featureFile)));
  const parts = fileParts(filepath);
  const templates = input.stepDefinitions ?? DEFAULT_STEP_DEFINITIONS;
  const roots = new Set<string>([featureRoot]);
  for (const template of templates) {
    for (const expansion of expandTemplate(template, filepath, parts)) {
      const pattern = isAbsolute(expansion.pattern)
        ? posix(expansion.pattern)
        : posix(resolve(featureRoot, expansion.pattern));
      roots.add(globParent(pattern));
    }
  }
  return [...roots].sort().filter((candidate, _index, all) => !all.some((other) => {
    if (other === candidate) return false;
    const path = relative(other, candidate);
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  }));
}

function pairingSignature(glue: readonly PairedGlue[]): string {
  return glue.map(({ path, tier, scope }) => `${tier}\0${scope}\0${path}`).join('\n');
}

interface SourceIndex {
  readonly scenarios: ReadonlyMap<string, Scenario>;
  readonly scenarioRules: ReadonlyMap<string, string>;
  readonly steps: ReadonlyMap<string, Step>;
  readonly backgroundSteps: ReadonlySet<string>;
}

function indexDocument(document: GherkinDocument): SourceIndex {
  const scenarios = new Map<string, Scenario>();
  const scenarioRules = new Map<string, string>();
  const steps = new Map<string, Step>();
  const backgroundSteps = new Set<string>();
  const recordSteps = (items: readonly Step[], background: boolean): void => {
    for (const step of items) {
      steps.set(step.id, step);
      if (background) backgroundSteps.add(step.id);
    }
  };
  const recordScenario = (scenario: Scenario, rule?: string): void => {
    scenarios.set(scenario.id, scenario);
    if (rule !== undefined) scenarioRules.set(scenario.id, rule);
    recordSteps(scenario.steps, false);
  };

  for (const child of document.feature?.children ?? []) {
    if (child.background !== undefined) recordSteps(child.background.steps, true);
    if (child.scenario !== undefined) recordScenario(child.scenario);
    for (const ruleChild of child.rule?.children ?? []) {
      if (ruleChild.background !== undefined) recordSteps(ruleChild.background.steps, true);
      if (ruleChild.scenario !== undefined) recordScenario(ruleChild.scenario, child.rule?.name);
    }
  }
  return { scenarios, scenarioRules, steps, backgroundSteps };
}

function importedPath(featureFile: string, glueFile: string): string {
  let specifier = posix(relative(dirname(featureFile), glueFile));
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  return specifier;
}

function pickleArgument(pickle: Pickle['steps'][number]): unknown {
  if (pickle.argument?.docString !== undefined) return pickle.argument.docString.content;
  if (pickle.argument?.dataTable !== undefined) {
    return pickle.argument.dataTable.rows.map((row) => row.cells.map((cell) => cell.value));
  }
  return undefined;
}

/** Converts one physical feature into native `@termwright/test` declarations entirely in memory. */
/** The environment variable a CLI uses to add a tag filter to a run. */
export const GHERKIN_TAGS_ENV = 'TERMWRIGHT_GHERKIN_TAGS';

/**
 * Combines the project's tag filter with the one a command line asked for.
 *
 * Both are Cucumber tag expressions and both are restrictions, so the answer
 * is their conjunction — a config selecting `@component` and a run asking for
 * `not @slow` means both, not whichever was read last. Each side is
 * parenthesised because tag expressions contain `or`, and `a or b and c` is
 * not what either author wrote.
 */
export function composeTagExpressions(
  configured: string | undefined,
  requested: string | undefined,
): string | undefined {
  const parts = [configured, requested]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '');
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts.map((part) => `(${part})`).join(' and ');
}

export function transformFeature(input: TransformFeatureInput): TransformFeatureResult {
  const newId = IdGenerator.incrementing();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  const document = parser.parse(input.source);
  const feature = document.feature;
  if (feature === undefined) throw new Error(`No Feature found in ${input.uri}`);
  const tagExpression = input.tags === undefined || input.tags.trim() === ''
    ? undefined
    : parseTagExpression(input.tags);
  const pickles = compile(document, input.uri, newId).filter((pickle) =>
    tagExpression?.evaluate(pickle.tags.map((tag) => tag.name)) ?? true);
  const index = indexDocument(document);
  const sourceName = posix(input.uri);
  const map = new SourceMapGenerator({ file: sourceName });
  map.setSourceContent(sourceName, input.source);
  const lines: string[] = [];
  const scenarioLines: number[] = [];
  const emit = (code: string, originalLine?: number): void => {
    lines.push(code);
    if (originalLine !== undefined) {
      map.addMapping({
        generated: { line: lines.length, column: 0 },
        original: { line: originalLine, column: 0 },
        source: sourceName,
      });
    }
  };

  const generatedImports = input.generatedImports ?? DEFAULT_GENERATED_IMPORTS;
  emit(TRANSFORM_MARKER);
  emit(`import { describe, expect, test } from ${JSON.stringify(generatedImports.test)};`);
  emit(`import { createGherkinContext as __createContext, createGherkinRuntime as __createRuntime, runGherkinScenario as __runScenario, runGherkinStep as __runStep } from ${JSON.stringify(generatedImports.runtime)};`);
  input.glue.forEach((glue, index) => {
    emit(`import * as __glue${index} from ${JSON.stringify(importedPath(input.uri, glue.path))};`);
  });
  const modules = input.glue.map((glue, index) =>
    `{ path: ${JSON.stringify(posix(glue.path))}, tier: ${glue.tier}, definitions: __glue${index}.default }`);
  emit(`const __runtime = __createRuntime([${modules.join(', ')}]);`);
  const validationSteps = pickles.flatMap((pickle) => pickle.steps.map((step) => ({
    text: step.text,
    title: step.text,
  })));
  emit(`for (const __step of ${JSON.stringify(validationSteps)}) __runtime.validate(__step);`);
  emit(`describe(${JSON.stringify(feature.name)}, () => {`);

  const nameCounts = new Map<string, number>();
  for (const pickle of pickles) nameCounts.set(pickle.name, (nameCounts.get(pickle.name) ?? 0) + 1);
  const outlineRows = new Map<string, number>();
  for (const pickle of pickles) {
    const scenario = pickle.astNodeIds.map((id) => index.scenarios.get(id)).find(Boolean);
    const rule = pickle.astNodeIds.map((id) => index.scenarioRules.get(id)).find(Boolean);
    const scenarioLine = scenario?.location.line ?? pickle.location?.line ?? feature.location.line;
    const scenarioColumn = scenario?.location.column ?? pickle.location?.column ?? feature.location.column;
    const outline = (scenario?.examples.length ?? 0) > 0;
    const scenarioKey = scenario?.id ?? `${pickle.name}\0${scenarioLine}`;
    const outlineRow = (outlineRows.get(scenarioKey) ?? 0) + 1;
    outlineRows.set(scenarioKey, outlineRow);
    const testName = outline
      ? `${pickle.name} [example ${outlineRow}]`
      : (nameCounts.get(pickle.name) ?? 0) > 1
        ? `${pickle.name} [line ${scenarioLine}]`
        : pickle.name;
    scenarioLines.push(scenarioLine);
    const declarationMeta = {
      meta: {
        termwright: {
          source: { file: sourceName, line: scenarioLine, column: scenarioColumn },
          kind: outline
            ? 'gherkin-outline-example'
            : 'gherkin-scenario',
          ancestors: [
            { kind: 'feature', title: feature.name },
            ...(rule === undefined ? [] : [{ kind: 'rule', title: rule }]),
          ],
          tags: pickle.tags.map((tag) => tag.name),
        },
      },
    };
    emit(`test(${JSON.stringify(testName)}, ${JSON.stringify(declarationMeta)}, async ({ termwrightOptions, termwright, terminal, step }) => {`, scenarioLine);
    const metadata = {
      feature: feature.name,
      name: pickle.name,
      uri: sourceName,
      line: scenarioLine,
      tags: pickle.tags.map((tag) => tag.name),
    };
    emit(`const __context = __createContext({ termwrightOptions, termwright, terminal, step, expect, world: {}, scenario: ${JSON.stringify(metadata)} });`);
    emit('await __runScenario(__runtime, __context, async () => {');
    for (const pickleStep of pickle.steps) {
      const astStep = pickleStep.astNodeIds.map((id) => index.steps.get(id)).find(Boolean);
      const stepLine = astStep?.location.line ?? scenarioLine;
      const stepColumn = astStep?.location.column ?? scenarioColumn;
      const keyword = astStep?.keyword ?? '';
      const background = pickleStep.astNodeIds.some((id) => index.backgroundSteps.has(id));
      const title = `${keyword}${pickleStep.text}`;
      const argument = pickleArgument(pickleStep);
      const gherkin = {
        keyword: keyword.trim(),
        text: pickleStep.text,
        source: { file: sourceName, line: stepLine, column: stepColumn },
        ...(background ? { background: true } : {}),
      };
      const runtimeStep = argument === undefined
        ? { text: pickleStep.text, title, gherkin }
        : { text: pickleStep.text, title, argument, gherkin };
      emit(`await __runStep(__runtime, __context, ${JSON.stringify(runtimeStep)});`, stepLine);
    }
    emit('});');
    emit('});');
  }
  emit('});');

  const rawMap = map.toJSON();
  return {
    code: `${lines.join('\n')}\n`,
    map: { ...rawMap, version: Number(rawMap.version) },
    scenarioLines,
  };
}

/** Public Vite/Vitest plugin. It transforms `.feature` modules before other loaders. */
export function gherkinPlugin(options: GherkinPluginOptions = {}): Plugin {
  let config: ResolvedConfig;
  const featureGlue = new Map<string, readonly PairedGlue[]>();
  const pairingInput = (file: string): PairingInput => {
    const featureRoot = resolve(config.root, options.featureRoot ?? '.');
    return {
      featureFile: file,
      featureRoot,
      ...(options.stepDefinitions === undefined ? {} : { stepDefinitions: options.stepDefinitions }),
    };
  };
  return {
    name: '@termwright/gherkin',
    enforce: 'pre',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
      if (options.includeFeatures === true) {
        const test = (resolvedConfig as ResolvedConfig & { test?: { include?: string[] } }).test;
        if (test?.include !== undefined) {
          const featureIncludes = featureIncludesForVitest(test.include);
          for (const include of featureIncludes) {
            if (!test.include.includes(include)) test.include.push(include);
          }
        }
      }
    },
    async transform(source, id) {
      const file = id.split('?', 1)[0]!;
      if (extname(file) !== '.feature') return null;
      if (source.startsWith(TRANSFORM_MARKER)) return null;
      const input = pairingInput(file);
      const glue = await resolvePairing(input);
      for (const root of pairingWatchRoots(input)) this.addWatchFile(root);
      for (const item of glue) this.addWatchFile(item.path);
      featureGlue.set(file, glue);
      return transformFeature({
        source,
        uri: file,
        glue,
        ...(options.generatedImports === undefined ? {} : { generatedImports: options.generatedImports }),
        // The command line composes with the project's filter rather than
        // replacing it, and it arrives by environment because the transform
        // runs inside the runner's workers rather than in the process that
        // parsed the arguments.
        ...(() => {
          const tags = composeTagExpressions(options.tags, process.env[GHERKIN_TAGS_ENV]);
          return tags === undefined ? {} : { tags };
        })(),
      });
    },
    async handleHotUpdate(context: HmrContext) {
      const changedFile = resolve(context.file);
      const affected = [];
      for (const [feature, previous] of featureGlue) {
        const next = await resolvePairing(pairingInput(feature));
        featureGlue.set(feature, next);
        const pairingChanged = pairingSignature(previous) !== pairingSignature(next);
        const pairedFileChanged = previous.some(({ path }) => path === changedFile) ||
          next.some(({ path }) => path === changedFile);
        if (!pairingChanged && !pairedFileChanged) continue;
        const module = context.server.moduleGraph.getModuleById(feature);
        if (module !== undefined) affected.push(module);
      }
      if (affected.length === 0) return;
      return [...new Set([...context.modules, ...affected])];
    },
  };
}
