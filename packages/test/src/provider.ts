/** Declaration-time ownership of cases created by `@termwright/test`. */

import { getCurrentSuite } from 'vitest/suite';
import { termwrightProvider } from '@termwright/ui/provider';
import type {
  TermwrightProviderDeclaration,
  TermwrightProviderDeclaredMode,
} from '@termwright/ui/provider';

export const TERMWRIGHT_TEST_PROVIDER_ID = '@termwright/test' as const;

const marker = termwrightProvider(TERMWRIGHT_TEST_PROVIDER_ID);
type Callable = (...arguments_: never[]) => unknown;
const wrappedFunctions = new WeakMap<Callable, Callable>();

/**
 * Wraps Vitest's public Test API and marks exactly the tasks it declares.
 *
 * The wrapper is deliberately API-shaped instead of source-shaped: chained
 * modifiers, `each`/`for`, conditional APIs and project-owned `extend()` calls
 * all return functions and are recursively wrapped. No source scan or import
 * path heuristic participates in correctness.
 */
export function markTermwrightTestApi<T extends Callable>(api: T): T {
  const existing = wrappedFunctions.get(api);
  if (existing !== undefined) return existing as T;

  const wrapped = new Proxy(api, {
    apply(target, thisArg, argumentsList) {
      const before = currentTasks();
      const declaredMeta = declaredTermwrightMeta(argumentsList);
      const result = Reflect.apply(target, thisArg, argumentsList);
      markAddedTasks(before, currentTasks(), declaredMeta);
      return typeof result === 'function' ? markTermwrightTestApi(result as Callable) : result;
    },
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? markTermwrightTestApi(value as Callable) : value;
    },
  });
  wrappedFunctions.set(api, wrapped);
  wrappedFunctions.set(wrapped, wrapped);
  return wrapped as T;
}

type DeclaredTask = ReturnType<typeof getCurrentSuite>['tasks'][number];

function currentTasks(): readonly DeclaredTask[] | undefined {
  try {
    return [...getCurrentSuite().tasks];
  } catch {
    // `test.step()` is also a function property and runs after collection. It
    // has no collector to mark, and must remain a normal runtime helper.
    return undefined;
  }
}

function markAddedTasks(
  before: readonly DeclaredTask[] | undefined,
  after: readonly DeclaredTask[] | undefined,
  declaredMeta: Readonly<Record<string, unknown>> | undefined,
): void {
  if (after === undefined) return;
  const previous = new Set(before ?? []);
  for (const task of after) {
    if (previous.has(task) || task.type !== 'test') continue;
    const existing = task.meta.termwright;
    task.meta.termwright = {
      ...(typeof existing === 'object' && existing !== null ? existing : {}),
      ...declaredMeta,
      provider: marker,
      declaration: declarationOf(task),
    };
  }
}

/**
 * Vitest 3's project `collect()` model does not retain arbitrary `options.meta`
 * fields consistently. The provider wrapper sees the public call arguments at
 * declaration time, so copy its own namespace onto the task alongside the
 * marker that already survives collection.
 */
function declaredTermwrightMeta(argumentsList: readonly unknown[]): Readonly<Record<string, unknown>> | undefined {
  const second = argumentsList[1];
  const third = argumentsList[2];
  const options = typeof second === 'object' && second !== null
    ? second
    : typeof third === 'object' && third !== null
      ? third
      : undefined;
  if (options === undefined) return undefined;
  const meta = (options as Record<string, unknown>)['meta'];
  if (typeof meta !== 'object' || meta === null) return undefined;
  const termwright = (meta as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null) return undefined;
  return { ...(termwright as Record<string, unknown>) };
}

interface ModeOwner {
  readonly mode: string;
  readonly suite?: ModeOwner;
}

function declarationOf(task: ModeOwner): TermwrightProviderDeclaration {
  let mode = declaredMode(task.mode);
  let exclusive = task.mode === 'only';
  let parent = task.suite;
  while (parent !== undefined) {
    const parentMode = declaredMode(parent.mode);
    if (parentMode === 'skip') mode = 'skip';
    else if (parentMode === 'todo' && mode === 'run') mode = 'todo';
    exclusive ||= parent.mode === 'only';
    parent = parent.suite;
  }
  return { mode, exclusive };
}

function declaredMode(mode: string): TermwrightProviderDeclaredMode {
  if (mode === 'skip') return 'skip';
  if (mode === 'todo') return 'todo';
  return 'run';
}
