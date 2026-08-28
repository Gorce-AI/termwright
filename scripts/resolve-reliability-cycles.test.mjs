import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAXIMUM_CERTIFIED_CYCLES,
  MINIMUM_CERTIFIED_CYCLES,
  resolveReliabilityCycles,
} from './resolve-reliability-cycles.mjs';

const exec = promisify(execFile);
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('reliability certification cycle count', () => {
  it('uses the certifying minimum for a scheduled run without an input', () => {
    expect(resolveReliabilityCycles()).toBe(String(MINIMUM_CERTIFIED_CYCLES));
    expect(resolveReliabilityCycles('')).toBe(String(MINIMUM_CERTIFIED_CYCLES));
  });

  it('accepts the closed certifying range', () => {
    expect(resolveReliabilityCycles('250')).toBe('250');
    expect(resolveReliabilityCycles('10000')).toBe(String(MAXIMUM_CERTIFIED_CYCLES));
  });

  it('executes the policy CLI through a symlinked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tw-reliability-cli-'));
    temporary.push(root);
    const linkedDirectory = join(root, 'scripts-link');
    await symlink(
      import.meta.dirname,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      exec(process.execPath, [join(linkedDirectory, 'resolve-reliability-cycles.mjs'), '250']),
    ).resolves.toMatchObject({ stdout: '250\n' });
  });

  it.each(['249', '10001', '0', '-250', '0250', '250.0', 'abc'])(
    'rejects non-certifying input %s',
    (value) => expect(() => resolveReliabilityCycles(value)).toThrow(/certifying cycles/u),
  );
});
