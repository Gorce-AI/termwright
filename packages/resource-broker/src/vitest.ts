/** Declaration-time resource ownership for tests run by the Termwright host. */

import { TestRunner, it as vitestIt, test as vitestTest } from 'vitest';
import {
  termwrightProvider,
  type TermwrightProviderDeclaration,
  type TermwrightProviderDeclaredMode,
} from '@termwright/protocol/test-provider';

export const TERMWRIGHT_TEST_PROVIDER_ID = '@termwright/test' as const;

const marker = Object.freeze(termwrightProvider(TERMWRIGHT_TEST_PROVIDER_ID));
type Callable = (...arguments_: never[]) => unknown;
const wrappedFunctions = new WeakMap<Callable, Callable>();

export interface TermwrightTestResources {
  /** Maximum simultaneously live terminal sessions in this Attempt. */
  readonly terminals?: number;
  /** Maximum simultaneously live retained trace writers in this Attempt. */
  readonly traceWriters?: number;
  /** Makes native transport pressure exclusive while preserving the true terminal count. */
  readonly nativeHost?: 'shared' | 'exclusive';
  /** Exclusively reserves host-wide process/toolchain pressure without requiring a terminal. */
  readonly hostPressure?: 'exclusive';
  /** Coarse host CPU/memory/I/O admission cost; defaults to `normal`. */
  readonly load?: 'light' | 'normal' | 'heavy' | 'exclusive';
}

/** Vitest's Test API with declaration-time atomic resource ownership. */
export type ResourceAwareTestApi<T> = T & {
  resources(resources: TermwrightTestResources): ResourceAwareTestApi<T>;
};

export function markTermwrightTestApi<T extends Callable>(api: T): ResourceAwareTestApi<T> {
  return wrapTermwrightTestApi(api) as ResourceAwareTestApi<T>;
}

export const it = markTermwrightTestApi(vitestIt);
export const test = markTermwrightTestApi(vitestTest);

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
    if (
      key !== 'terminals' &&
      key !== 'traceWriters' &&
      key !== 'nativeHost' &&
      key !== 'hostPressure' &&
      key !== 'load'
    ) {
      throw new TypeError(`test.resources() does not recognize ${key}`);
    }
  }
  const result: {
    terminals?: number;
    traceWriters?: number;
    nativeHost?: 'shared' | 'exclusive';
    hostPressure?: 'exclusive';
    load?: 'light' | 'normal' | 'heavy' | 'exclusive';
  } = {};
  for (const key of ['terminals', 'traceWriters'] as const) {
    const amount = record[key];
    if (amount === undefined) continue;
    if (!Number.isSafeInteger(amount) || (amount as number) < 0 || (amount as number) > 1_024) {
      throw new RangeError(`test.resources().${key} must be an integer between 0 and 1024`);
    }
    result[key] = amount as number;
  }
  const nativeHost = record['nativeHost'];
  if (nativeHost !== undefined && nativeHost !== 'shared' && nativeHost !== 'exclusive') {
    throw new TypeError('test.resources().nativeHost must be shared or exclusive');
  }
  if (nativeHost !== undefined) result.nativeHost = nativeHost;
  const hostPressure = record['hostPressure'];
  if (hostPressure !== undefined && hostPressure !== 'exclusive') {
    throw new TypeError('test.resources().hostPressure must be exclusive');
  }
  if (hostPressure !== undefined) result.hostPressure = hostPressure;
  const load = record['load'];
  if (
    load !== undefined &&
    load !== 'light' &&
    load !== 'normal' &&
    load !== 'heavy' &&
    load !== 'exclusive'
  ) {
    throw new TypeError('test.resources().load must be light, normal, heavy or exclusive');
  }
  if (load !== undefined) result.load = load;
  if (result.nativeHost !== undefined && result.hostPressure !== undefined) {
    throw new TypeError('test.resources() cannot combine nativeHost and hostPressure');
  }
  if (
    (result.terminals ?? 0) === 0 &&
    (result.traceWriters ?? 0) === 0 &&
    result.hostPressure === undefined &&
    result.load === undefined
  ) {
    throw new RangeError('test.resources() must reserve at least one resource');
  }
  if (result.nativeHost === 'exclusive' && (result.terminals ?? 0) === 0) {
    throw new RangeError('test.resources().nativeHost exclusive requires at least one terminal');
  }
  return Object.freeze(result);
}

type DeclaredTask = ReturnType<typeof TestRunner.getCurrentSuite>['tasks'][number];

function currentTasks(): readonly DeclaredTask[] | undefined {
  try {
    return [...TestRunner.getCurrentSuite().tasks];
  } catch {
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
    const metadata = task.meta as Record<string, unknown>;
    const existing = metadata['termwright'];
    metadata['termwright'] = {
      ...(typeof existing === 'object' && existing !== null ? existing : {}),
      ...declaredMeta,
      provider: marker,
      declaration: declarationOf(task),
    };
  }
}

function declaredTermwrightMeta(
  argumentsList: readonly unknown[],
): Readonly<Record<string, unknown>> | undefined {
  const second = argumentsList[1];
  const third = argumentsList[2];
  const options =
    typeof second === 'object' && second !== null
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
