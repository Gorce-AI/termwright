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

/** Resources atomically admitted before Vitest starts the authored try. */
export interface TermwrightTestResources {
  /** Maximum simultaneously live terminal sessions in this Attempt. */
  readonly terminals?: number;
  /** Maximum simultaneously live retained trace writers in this Attempt. */
  readonly traceWriters?: number;
}

export type ResourceAwareTestApi<T> = T & {
  resources(resources: TermwrightTestResources): ResourceAwareTestApi<T>;
};

/**
 * Wraps Vitest's public Test API and marks exactly the tasks it declares.
 *
 * The wrapper is deliberately API-shaped instead of source-shaped: chained
 * modifiers, `each`/`for`, conditional APIs and project-owned `extend()` calls
 * all return functions and are recursively wrapped. No source scan or import
 * path heuristic participates in correctness.
 */
export function markTermwrightTestApi<T extends Callable>(api: T): ResourceAwareTestApi<T> {
  return wrapTermwrightTestApi(api) as ResourceAwareTestApi<T>;
}

function wrapTermwrightTestApi<T extends Callable>(
  api: T,
  inheritedResources?: Readonly<TermwrightTestResources>,
): T {
  if (inheritedResources !== undefined) return createWrapper(api, inheritedResources);
  const existing = wrappedFunctions.get(api);
  if (existing !== undefined) return existing as T;

  const wrapped = createWrapper(api);
  wrappedFunctions.set(api, wrapped);
  wrappedFunctions.set(wrapped, wrapped);
  return wrapped as T;
}

function createWrapper<T extends Callable>(
  api: T,
  inheritedResources?: Readonly<TermwrightTestResources>,
): T {
  const wrapped = new Proxy(api, {
    apply(target, thisArg, argumentsList) {
      const before = currentTasks();
      const declaredMeta = declaredTermwrightMeta(argumentsList);
      const result = Reflect.apply(target, thisArg, argumentsList);
      markAddedTasks(before, currentTasks(), {
        ...declaredMeta,
        ...(inheritedResources === undefined ? {} : { resources: inheritedResources }),
      });
      return typeof result === 'function'
        ? wrapTermwrightTestApi(result as Callable, inheritedResources)
        : result;
    },
    get(target, property) {
      if (property === 'resources') {
        return (resources: TermwrightTestResources) => {
          if (inheritedResources !== undefined) {
            throw new TypeError('test.resources() may be declared only once in a test chain');
          }
          return wrapTermwrightTestApi(target, validateResources(resources));
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? wrapTermwrightTestApi(value as Callable, inheritedResources)
        : value;
    },
  });
  return wrapped as T;
}

function validateResources(value: TermwrightTestResources): Readonly<TermwrightTestResources> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('test.resources() requires an object');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'terminals' && key !== 'traceWriters') {
      throw new TypeError(`test.resources() does not recognize ${key}`);
    }
  }
  const result: { terminals?: number; traceWriters?: number } = {};
  for (const key of ['terminals', 'traceWriters'] as const) {
    const amount = record[key];
    if (amount === undefined) continue;
    if (!Number.isSafeInteger(amount) || (amount as number) < 0 || (amount as number) > 1_024) {
      throw new RangeError(`test.resources().${key} must be an integer between 0 and 1024`);
    }
    result[key] = amount as number;
  }
  if ((result.terminals ?? 0) === 0 && (result.traceWriters ?? 0) === 0) {
    throw new RangeError('test.resources() must reserve at least one resource');
  }
  return Object.freeze(result);
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
