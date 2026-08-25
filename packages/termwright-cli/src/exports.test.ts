/**
 * The umbrella's promise is that a project can put one package in
 * `devDependencies` and use every supported product surface. These assertions
 * are the cheap version of that promise: every first-class subpath resolves,
 * while removed reporter-based execution paths stay absent.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('subpath entry points', () => {
  it('exposes the driver from the root, with no test-runner import', async () => {
    const root = await import('./index.js');
    expect(root.launchTerminal).toBeTypeOf('function');
    expect(root.TermwrightError).toBeTypeOf('function');
  });

  it('exposes the Native Host authoring API from termwright/test', async () => {
    const preset = await import('./test.js');
    expect(preset.test).toBeTypeOf('function');
    expect(preset.expect).toBeTypeOf('function');
  });

  it('exposes Ink component testing from termwright/ink', async () => {
    const ink = await import('./ink.js');
    expect(ink.mountInk).toBeTypeOf('function');
    expect(ink.launchInkFixture).toBeTypeOf('function');
  });

  it('exposes Gherkin authoring and the explicit plugin from termwright/gherkin', async () => {
    const gherkin = await import('./gherkin.js');
    expect(gherkin.Given).toBeTypeOf('function');
    expect(gherkin.defineSteps).toBeTypeOf('function');
    expect(gherkin.gherkinPlugin).toBeTypeOf('function');
  });

  it('keeps transformed feature imports on umbrella subpaths', async () => {
    const { gherkinPlugin } = await import('./gherkin.js');
    const plugin = gherkinPlugin();
    const resolveConfig = typeof plugin.configResolved === 'function'
      ? plugin.configResolved
      : plugin.configResolved?.handler;
    (resolveConfig as undefined | ((config: { root: string }) => void))?.({ root: '/tmp' });
    const transform = typeof plugin.transform === 'function'
      ? plugin.transform
      : plugin.transform?.handler;
    const result = await (transform as unknown as (this: { addWatchFile(): void }, source: string, id: string) => Promise<{ code: string }>).call(
      { addWatchFile() {} },
      'Feature: umbrella\n\n  Scenario: strict install\n    Given a value\n',
      '/tmp/umbrella.feature',
    );

    expect(result.code).toContain('from "termwright/test"');
    expect(result.code).toContain('from "termwright/gherkin/runtime"');
    expect(result.code).not.toContain('from "@termwright/test"');
  });

  it('resolves generated subpaths from a strict consumer with only termwright installed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-strict-consumer-'));
    try {
      const modules = join(directory, 'node_modules');
      await mkdir(modules);
      await symlink(packageRoot, join(modules, 'termwright'), 'dir');
      await writeFile(join(directory, 'check.mjs'), `
        if (!import.meta.resolve('termwright/test').endsWith('/dist/test.js')) {
          throw new Error('termwright/test did not resolve through the umbrella');
        }
        if (!import.meta.resolve('termwright/gherkin/runtime').endsWith('/dist/gherkin-runtime.js')) {
          throw new Error('termwright/gherkin/runtime did not resolve through the umbrella');
        }
        for (const removed of ['termwright/reporter', 'termwright/ui-reporter']) {
          try {
            import.meta.resolve(removed);
            throw new Error(removed + ' unexpectedly resolved');
          } catch (error) {
            if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
          }
        }
        try {
          import.meta.resolve('@termwright/test');
          throw new Error('strict consumer unexpectedly resolved a transitive package');
        } catch (error) {
          if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        }
      `, 'utf8');

      await expect(execFileAsync(process.execPath, [join(directory, 'check.mjs')], { cwd: directory }))
        .resolves.toMatchObject({ stderr: '' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('loads the native host outside a Vitest worker', async () => {
    const host = await import('./host.js');
    expect(host.TermwrightTestHost).toBeTypeOf('function');
  });

});
