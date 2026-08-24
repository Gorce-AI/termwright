import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function collectVitestConfigs(directory, output) {
  const children = await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true });
  for (const child of children) {
    const file = `${directory}/${child.name}`;
    if (child.isDirectory()) {
      if (!['node_modules', 'dist', 'target', '.venv'].includes(child.name)) await collectVitestConfigs(file, output);
    } else if (/(?:vitest.*config|config.*vitest)\.[cm]?[jt]s$/u.test(child.name)) output.push(file);
  }
}

function workflowJobBlocks(source) {
  const jobs = source.indexOf('\njobs:\n');
  if (jobs === -1) return [];
  const body = source.slice(jobs + 1);
  const starts = [...body.matchAll(/^ {2}[A-Za-z0-9_-]+:\n/gmu)].map((match) => match.index);
  return starts.map((start, index) => body.slice(start, starts[index + 1] ?? body.length));
}

describe('the native host is the only Termwright test entrypoint', () => {
  it('keeps repository and release certification single-attempt', async () => {
    const rootConfig = (await import('../vitest.config.ts')).default;
    const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const release = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    const reliability = await readFile(new URL('../.github/workflows/reliability.yml', import.meta.url), 'utf8');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(rootConfig.test.retry).toBe(0);
    expect(ci).toMatch(/^env:\n(?: {2}.*\n)* {2}TERMWRIGHT_RETRIES: '0'$/mu);
    expect(release).toMatch(/^env:\n {2}TERMWRIGHT_RETRIES: '0'$/mu);
    for (const workflow of [ci, release, reliability]) {
      expect(workflow).toContain("TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1'");
    }
    const upstream = await readFile(new URL('../.github/workflows/upstream-candidates.yml', import.meta.url), 'utf8');
    const vitestReliability = await readFile(new URL('../.github/workflows/vitest-reliability.yml', import.meta.url), 'utf8');
    for (const [name, workflow] of [['CI', ci], ['Release', release], ['nightly reliability', reliability], ['Vitest reliability', vitestReliability], ['upstream certification', upstream]]) {
      const jobs = workflowJobBlocks(workflow);
      expect(jobs.length, `${name} must contain certification jobs`).toBeGreaterThan(0);
      for (const job of jobs) {
        expect(job, `${name} job must reject reruns as its first step`).toMatch(
          /    steps:\n      - name: Reject workflow reruns\n        shell: bash\n        run: test "\$GITHUB_RUN_ATTEMPT" = 1/u,
        );
      }
    }
    expect(`${ci}\n${release}\n${reliability}\n${JSON.stringify(manifest.scripts)}`).not.toMatch(/--retry(?:=|\s)/u);

    const configFiles = ['vitest.config.ts'];
    for (const directory of ['packages', 'examples', 'quality']) {
      await collectVitestConfigs(directory, configFiles);
    }
    for (const file of configFiles) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/\bretry\s*:\s*([^,\n}]+)/gu)) {
        expect(match[1]?.trim(), `${file} must not enable test retry`).toBe('0');
      }
    }

    for (const directory of ['packages', 'examples', 'clients']) {
      const entries = await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const workspaceManifest = JSON.parse(await readFile(new URL(`../${directory}/${entry.name}/package.json`, import.meta.url), 'utf8'));
          expect(JSON.stringify(workspaceManifest.scripts ?? {}), `${directory}/${entry.name}/package.json must not enable retry`).not.toMatch(/--retry(?:=|\s)/u);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    }

    const workflows = (await readdir(new URL('../.github/workflows/', import.meta.url)))
      .filter((file) => /\.ya?ml$/u.test(file));
    for (const file of workflows) {
      const source = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
      expect(source, `${file} must not retry tests or failed jobs`).not.toMatch(/--retry(?:=|\s)|rerun-failed-jobs|\bgh run rerun\b/u);
    }
  });

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
      expect(command, entry.name).not.toMatch(/--retry(?:=|\s)/u);
      expect(command, entry.name).not.toMatch(/(?:^|\s)vitest(?:\s|$)/u);
      expect(command, entry.name).toMatch(/(?:termwright-cli\/dist\/bin\.js test|pnpm --dir \.\.\/\.\. test)/u);
      for (const dependencies of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
        if (dependencies?.vitest !== undefined) expect(dependencies.vitest, `${entry.name} Vitest range`).toBe('4.1.11');
      }
    }
  });

  it('does not let conformance resurrect a reporter-parsing Vitest scheduler', async () => {
    const source = await readFile(new URL('../packages/conformance/scripts/conformance.mjs', import.meta.url), 'utf8');
    expect(source).toContain('TermwrightTestHost.open');
    expect(source).not.toMatch(/spawn|reporter=json|vitestEntry|VITEST/u);
  });
});
