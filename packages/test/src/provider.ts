/** Public resource declarations backed by Termwright's private engine adapter. */

import { it as vitestIt, test as vitestTest } from 'vitest';
import { markTermwrightTestApi as markInternalTestApi } from '@termwright/test-provider-internal';

export const TERMWRIGHT_TEST_PROVIDER_ID = '@termwright/test' as const;

export interface TermwrightTestResources {
  /** Maximum simultaneously live terminal sessions in this Attempt. */
  readonly terminals?: number;
  /** Maximum simultaneously live retained trace writers in this Attempt. */
  readonly traceWriters?: number;
  /** Makes native transport pressure exclusive while preserving the true terminal count. */
  readonly nativeHost?: 'shared' | 'exclusive';
  /** Exclusively reserves host-wide CPU, memory, I/O and process/toolchain pressure. */
  readonly hostPressure?: 'exclusive';
  /** Coarse host CPU/memory/I/O admission cost; defaults to `normal`. */
  readonly load?: 'light' | 'normal' | 'heavy' | 'exclusive';
}

export type ResourceAwareTestApi<T> = T & {
  resources(resources: TermwrightTestResources): ResourceAwareTestApi<T>;
};

type Callable = (...arguments_: never[]) => unknown;

export function markTermwrightTestApi<T extends Callable>(api: T): ResourceAwareTestApi<T> {
  return markInternalTestApi(api) as ResourceAwareTestApi<T>;
}

export const it = markTermwrightTestApi(vitestIt);
export const test = markTermwrightTestApi(vitestTest);
