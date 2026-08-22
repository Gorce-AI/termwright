import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('the native host is the only Termwright test entrypoint', () => {
  it('keeps root test and watch commands on the native host', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.scripts.test).toContain('termwright-cli/dist/bin.js test');
    expect(manifest.scripts['test:watch']).toContain('termwright-cli/dist/bin.js watch');
    expect(`${manifest.scripts.test}\n${manifest.scripts['test:watch']}`).not.toMatch(/(?:^|\s)vitest(?:\s|$)/u);
  });

  it('keeps every package test script on the root native host', async () => {
    const entries = await readdir(new URL('../packages/', import.meta.url), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let manifest;
      try {
        manifest = JSON.parse(await readFile(new URL(`../packages/${entry.name}/package.json`, import.meta.url), 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const command = manifest.scripts?.test;
      if (command === undefined) continue;
      expect(command, entry.name).not.toMatch(/(?:^|\s)vitest(?:\s|$)/u);
      expect(command, entry.name).toMatch(/(?:termwright-cli\/dist\/bin\.js test|pnpm --dir \.\.\/\.\. test)/u);
      for (const dependencies of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
        if (dependencies?.vitest !== undefined) expect(dependencies.vitest, `${entry.name} Vitest range`).toBe('3.2.7');
      }
    }
  });

  it('does not let conformance resurrect a reporter-parsing Vitest scheduler', async () => {
    const source = await readFile(new URL('../packages/conformance/scripts/conformance.mjs', import.meta.url), 'utf8');
    expect(source).toContain('TermwrightTestHost.open');
    expect(source).not.toMatch(/spawn|reporter=json|vitestEntry|VITEST/u);
  });
});
