import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isDirectExecution } from './is-direct-execution.mjs';

const temporary = [];
const helperUrl = new URL('./is-direct-execution.mjs', import.meta.url).href;
const helperPath = fileURLToPath(helperUrl);

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('direct module execution detection', () => {
  it('distinguishes imports and non-file argv entries without throwing', () => {
    expect(isDirectExecution(helperUrl, undefined)).toBe(false);
    expect(isDirectExecution(helperUrl, '-')).toBe(false);
    expect(isDirectExecution(helperUrl, resolve('missing-direct-entry.mjs'))).toBe(false);
    expect(isDirectExecution(helperUrl, fileURLToPath(import.meta.url))).toBe(false);
    expect(isDirectExecution(helperUrl, helperPath)).toBe(true);
  });

  it('recognizes a direct entry reached through a symlinked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tw-direct-execution-'));
    temporary.push(root);
    const linkedDirectory = join(root, 'scripts-link');
    await symlink(
      import.meta.dirname,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(isDirectExecution(helperUrl, join(linkedDirectory, 'is-direct-execution.mjs'))).toBe(
      true,
    );
  });
});
