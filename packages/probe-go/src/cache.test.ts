import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cacheRoot,
  copyDir,
  copyKey,
  isComplete,
  markComplete,
  prepareCopyDir,
  stampPath,
  type CopyKeyInput,
} from './cache.js';

const base: CopyKeyInput = {
  framework: 'github.com/rivo/tview',
  frameworkVersion: 'v0.42.0',
  probeVersion: '0.1.0',
  toolchain: 'go version go1.24.4 darwin/arm64',
  patchDigest: 'sha256:abc',
};

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tw-cache-'));
  roots.push(dir);
  return dir;
}

describe('the key', () => {
  it('is stable for the same inputs', () => {
    expect(copyKey(base)).toBe(copyKey({ ...base }));
  });

  it('changes with every input that can change the copy', () => {
    const keys = new Set([
      copyKey(base),
      copyKey({ ...base, frameworkVersion: 'v0.43.0' }),
      copyKey({ ...base, probeVersion: '0.2.0' }),
      copyKey({ ...base, toolchain: 'go version go1.25.0 darwin/arm64' }),
      copyKey({ ...base, patchDigest: 'sha256:def' }),
      copyKey({ ...base, framework: 'github.com/other/tview' }),
    ]);

    expect(keys.size).toBe(6);
  });

  it('cannot be collided by moving a character between fields', () => {
    // Without length prefixes, ("ab","c") and ("a","bc") hash the same — the
    // classic way a cache serves the wrong artifact.
    const left = copyKey({ ...base, frameworkVersion: 'v1', probeVersion: '0.1.0' });
    const right = copyKey({ ...base, frameworkVersion: 'v', probeVersion: '10.1.0' });

    expect(left).not.toBe(right);
  });
});

describe('the location', () => {
  it('prefers TERMWRIGHT_CACHE_DIR, then XDG, then home', () => {
    expect(cacheRoot({ TERMWRIGHT_CACHE_DIR: '/explicit', XDG_CACHE_HOME: '/xdg', HOME: '/home' })).toBe(
      '/explicit',
    );
    expect(cacheRoot({ XDG_CACHE_HOME: '/xdg', HOME: '/home' })).toBe(join('/xdg', 'termwright'));
    expect(cacheRoot({ HOME: '/home' })).toBe(join('/home', '.cache', 'termwright'));
  });

  it('keeps the framework and version legible in the path', () => {
    const dir = copyDir(base, { TERMWRIGHT_CACHE_DIR: '/c' });

    expect(dir).toContain('github.com-rivo-tview');
    expect(dir).toContain('v0.42.0-');
    // A module path must not become a directory traversal.
    expect(dir.startsWith(join('/c', 'copies'))).toBe(true);
  });
});

describe('completeness', () => {
  it('treats a directory without the stamp as unfinished', async () => {
    const dir = join(await scratch(), 'copy');
    await prepareCopyDir(dir);
    await writeFile(join(dir, 'framework.go'), 'package framework\n', 'utf8');

    expect(await isComplete(dir)).toBe(false);

    await markComplete(dir, base);
    expect(await isComplete(dir)).toBe(true);
  });

  it('records the key that produced the copy, so a stale one can be explained', async () => {
    const dir = join(await scratch(), 'copy');
    await prepareCopyDir(dir);
    await markComplete(dir, base);

    const { readFile } = await import('node:fs/promises');
    const stamped = JSON.parse(await readFile(stampPath(dir), 'utf8')) as CopyKeyInput;

    expect(stamped.frameworkVersion).toBe('v0.42.0');
    expect(stamped.toolchain).toContain('go1.24.4');
  });

  it('clears a half-built copy rather than building on top of it', async () => {
    const dir = join(await scratch(), 'copy');
    await prepareCopyDir(dir);
    await writeFile(join(dir, 'leftover.go'), 'package broken\n', 'utf8');

    await prepareCopyDir(dir);

    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual([]);
  });
});
