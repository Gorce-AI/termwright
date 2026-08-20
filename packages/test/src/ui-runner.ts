/** UI-only Vitest runner: foreign cases are collected but never executed. */

import { VitestTestRunner } from 'vitest/runners';
import {
  hasTermwrightProvider,
  termwrightProviderDeclaration,
  type TermwrightProviderDeclaration,
} from '@termwright/ui/provider';
import { parseDiscoveredId, UI_SELECTION_ENV } from '@termwright/ui';

export const UI_LOCATION_FILTER_ENV = 'TERMWRIGHT_UI_LOCATION_FILTER';

interface RunnerTask {
  readonly type: 'test' | 'suite';
  readonly name: string;
  mode: string;
  readonly meta: unknown;
  readonly tasks?: RunnerTask[];
  readonly suite?: RunnerSuite;
  readonly filepath?: string;
}

interface RunnerSuite extends RunnerTask {
  readonly type: 'suite';
  readonly tasks: RunnerTask[];
}

/**
 * Applied only by `termwright ui`; ordinary Vitest invocations keep their
 * configured runner and execute the suite exactly as before.
 */
export default class TermwrightUiRunner extends VitestTestRunner {
  onCollected(files: RunnerSuite[]): void {
    const selectedCases = selectedCasesFromEnvironment();
    for (const file of files) {
      filterSuite(file, {
        ...(this.config.testNamePattern === undefined
          ? {}
          : { testNamePattern: this.config.testNamePattern }),
        restoreDeclaredModes: process.env[UI_LOCATION_FILTER_ENV] !== '1',
        ...(selectedCases.length === 0 ? {} : { selectedCases }),
      });
    }
  }
}

export interface FilterSuiteOptions {
  readonly testNamePattern?: RegExp;
  /** Exact discovered (file,title) pairs selected by the browser. */
  readonly selectedCases?: readonly { readonly file: string; readonly title: string }[];
  /** False preserves Vitest's file:line decision, which the runner cannot reconstruct. */
  readonly restoreDeclaredModes?: boolean;
}

/** Returns whether this suite contains at least one provider-owned case. */
export function filterSuite(suite: RunnerSuite, options: FilterSuiteOptions = {}): boolean {
  const declarations = providerDeclarations(suite);
  const hasExclusive = declarations.some(
    ({ declaration }) => declaration?.mode === 'run' && declaration.exclusive,
  );
  return filterBranch(suite, options, hasExclusive).ownsCase;
}

function filterBranch(
  suite: RunnerSuite,
  options: FilterSuiteOptions,
  hasExclusive: boolean,
): { readonly ownsCase: boolean; readonly runsCase: boolean } {
  let ownsCase = false;
  let runsCase = false;
  for (const task of suite.tasks) {
    if (task.type === 'suite') {
      const nested = filterBranch(task as RunnerSuite, options, hasExclusive);
      ownsCase ||= nested.ownsCase;
      runsCase ||= nested.runsCase;
      continue;
    }
    if (!hasTermwrightProvider(task.meta)) {
      skip(task);
      continue;
    }
    ownsCase = true;
    const declaration = termwrightProviderDeclaration(task.meta);
    if (options.restoreDeclaredModes !== false && declaration !== undefined) {
      task.mode = declaration.mode;
      if (task.mode === 'run' && hasExclusive && !declaration.exclusive) skip(task);
    }
    if (runs(task) && !matchesName(task, options.testNamePattern)) skip(task);
    if (runs(task) && !matchesSelection(task, options.selectedCases)) skip(task);
    runsCase ||= task.mode === 'run' || task.mode === 'queued' || task.mode === 'only';
  }
  suite.mode = runsCase ? 'run' : 'skip';
  return { ownsCase, runsCase };
}

function providerDeclarations(
  suite: RunnerSuite,
): { readonly task: RunnerTask; readonly declaration: TermwrightProviderDeclaration | undefined }[] {
  const declarations: {
    readonly task: RunnerTask;
    readonly declaration: TermwrightProviderDeclaration | undefined;
  }[] = [];
  for (const task of suite.tasks) {
    if (task.type === 'suite') {
      declarations.push(...providerDeclarations(task as RunnerSuite));
    } else if (hasTermwrightProvider(task.meta)) {
      declarations.push({ task, declaration: termwrightProviderDeclaration(task.meta) });
    }
  }
  return declarations;
}

function matchesName(task: RunnerTask, pattern: RegExp | undefined): boolean {
  if (pattern === undefined) return true;
  const names = [task.name];
  let parent = task.suite;
  while (parent !== undefined && parent.filepath === undefined) {
    names.unshift(parent.name);
    parent = parent.suite;
  }
  pattern.lastIndex = 0;
  return pattern.test(names.join(' '));
}

function matchesSelection(
  task: RunnerTask,
  selected: FilterSuiteOptions['selectedCases'],
): boolean {
  if (selected === undefined) return true;
  const names = [task.name];
  let parent = task.suite;
  let file = authoredFile(task.meta) ?? task.filepath;
  while (parent !== undefined) {
    if (parent.filepath !== undefined && file === undefined) file = parent.filepath;
    else names.unshift(parent.name);
    parent = parent.suite;
  }
  if (file === undefined) return false;
  const title = names.join(' > ');
  return selected.some((target) => target.file === file && target.title === title);
}

function authoredFile(meta: unknown): string | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const termwright = (meta as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null) return undefined;
  const source = (termwright as Record<string, unknown>)['source'];
  if (typeof source !== 'object' || source === null) return undefined;
  const file = (source as Record<string, unknown>)['file'];
  return typeof file === 'string' && file !== '' ? file : undefined;
}

function selectedCasesFromEnvironment(): readonly { readonly file: string; readonly title: string }[] {
  const raw = process.env[UI_SELECTION_ENV];
  if (raw === undefined || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((target): target is string => typeof target === 'string')
      .map(parseDiscoveredId)
      .filter((target): target is NonNullable<typeof target> => target !== null);
  } catch {
    return [];
  }
}

function skip(task: RunnerTask): void {
  task.mode = 'skip';
}

function runs(task: RunnerTask): boolean {
  return task.mode === 'run' || task.mode === 'queued' || task.mode === 'only';
}
