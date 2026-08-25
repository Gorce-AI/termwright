import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MINIMUM_CERTIFIED_CYCLES = 250;
export const MAXIMUM_CERTIFIED_CYCLES = 10_000;

export function resolveReliabilityCycles(input = '') {
  const value = input === '' ? String(MINIMUM_CERTIFIED_CYCLES) : input;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error('certifying cycles must be a positive base-10 integer');
  }
  const cycles = Number(value);
  if (cycles < MINIMUM_CERTIFIED_CYCLES || cycles > MAXIMUM_CERTIFIED_CYCLES) {
    throw new Error(
      `certifying cycles must be ${MINIMUM_CERTIFIED_CYCLES}..${MAXIMUM_CERTIFIED_CYCLES}`,
    );
  }
  return String(cycles);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolvePath(invokedPath)).href === import.meta.url) {
  try {
    console.log(resolveReliabilityCycles(process.argv[2]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
