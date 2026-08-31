import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '../packages/resource-broker/src/vitest.ts';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { checkNpmReleaseReadiness } from './check-npm-release-readiness.mjs';

const roots = [];
const exec = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });
const message = 'Package retired; use @termwright/ink instead.';
const bootstrapMessage = 'Registry bootstrap placeholder; install version 0.3.0 or newer.';
const bootstrapPolicy = {
  schemaVersion: 2,
  version: '0.0.0-bootstrap.0',
  tag: 'bootstrap',
  deprecationMessage: bootstrapMessage,
  packages: ['@termwright/new-package'],
};
const policy = {
  schemaVersion: 1,
  scope: '@termwright',
  packages: [
    {
      name: '@termwright/ink-testing',
      replacement: '@termwright/ink',
      deprecationMessage: message,
    },
  ],
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(
  names = ['@termwright/ink', '@termwright/new-package'],
  version = '0.2.0',
) {
  const root = await mkdtemp(join(tmpdir(), 'tw-npm-readiness-'));
  roots.push(root);
  await Promise.all(
    names.map(async (name, index) => {
      const directory = join(root, `package-${index}`);
      await mkdir(directory);
      await writeFile(join(directory, 'package.json'), `${JSON.stringify({ name, version })}\n`);
    }),
  );
  return root;
}

function fetcher({
  inventory,
  deprecated = message,
  inventoryStatus = 200,
  retiredVersions,
  bootstrapPackument,
  bootstrapPackuments = {},
}) {
  return async (url) => {
    if (url.includes('/-/org/termwright/package')) {
      return response(inventoryStatus, inventory);
    }
    for (const [name, packument] of Object.entries(bootstrapPackuments)) {
      if (url.endsWith(encodeURIComponent(name))) return response(200, packument);
    }
    if (url.endsWith('%40termwright%2Fnew-package'))
      return bootstrapPackument === undefined
        ? response(404, {})
        : response(200, bootstrapPackument);
    if (url.endsWith('%40termwright%2Fink-testing')) {
      return response(200, {
        versions: retiredVersions ?? { '0.2.0': { deprecated } },
      });
    }
    if (url.endsWith('%40termwright%2Fink')) return response(200, {});
    throw new Error(`unexpected registry request ${url}`);
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

describe('npm release namespace readiness', () => {
  it('executes the CLI through a symlink instead of silently bypassing the gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tw-npm-readiness-cli-'));
    roots.push(root);
    const linkedDirectory = join(root, 'scripts-link');
    await symlink(
      resolve(import.meta.dirname),
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const linkedScript = join(linkedDirectory, 'check-npm-release-readiness.mjs');

    await expect(
      exec(process.execPath, [linkedScript, '--expect-missing', join(root, 'missing.json')]),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('accepts the primary release only when every active name exists', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(['@termwright/ink']),
        retiredPolicy: policy,
        fetchImpl: fetcher({
          inventory: { '@termwright/ink': 'write', '@termwright/ink-testing': 'write' },
        }),
      }),
    ).resolves.toContain('every public workspace package exists');
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        fetchImpl: fetcher({
          inventory: { '@termwright/ink': 'write', '@termwright/ink-testing': 'write' },
        }),
      }),
    ).rejects.toThrow(/missing a registry bootstrap/u);
  });

  it('accepts only the reviewed bootstrap gap and exactly deprecated retired package', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        bootstrapPolicy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({
          inventory: { '@termwright/ink': 'write', '@termwright/ink-testing': 'write' },
        }),
      }),
    ).resolves.toContain('exactly the reviewed 1-package bootstrap scope');
  });

  it('accepts the exact deprecated bootstrap placeholder with npm first-publish latest semantics', async () => {
    const exact = {
      versions: {
        '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
      },
      'dist-tags': {
        bootstrap: '0.0.0-bootstrap.0',
        latest: '0.0.0-bootstrap.0',
      },
    };
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        bootstrapPolicy,
        fetchImpl: fetcher({
          inventory: {
            '@termwright/ink': 'write',
            '@termwright/ink-testing': 'write',
            '@termwright/new-package': 'write',
          },
          bootstrapPackument: exact,
        }),
      }),
    ).resolves.toContain('every public workspace package exists');

    const afterFunctionalRelease = {
      versions: {
        '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
        '0.3.0': {},
      },
      'dist-tags': { bootstrap: '0.0.0-bootstrap.0', latest: '0.3.0' },
    };
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(undefined, '0.3.0'),
        retiredPolicy: policy,
        bootstrapPolicy,
        fetchImpl: fetcher({
          inventory: {
            '@termwright/ink': 'write',
            '@termwright/ink-testing': 'write',
            '@termwright/new-package': 'write',
          },
          bootstrapPackument: afterFunctionalRelease,
        }),
      }),
    ).resolves.toContain('every public workspace package exists');

    for (const bootstrapPackument of [
      { versions: {}, 'dist-tags': { bootstrap: '0.0.0-bootstrap.0' } },
      {
        versions: { '0.0.0-bootstrap.0': {} },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0' },
      },
      {
        versions: { '0.0.0-bootstrap.0': { deprecated: bootstrapMessage } },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0' },
      },
      {
        versions: { '0.0.0-bootstrap.0': { deprecated: bootstrapMessage } },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0', latest: '9.9.9' },
      },
      {
        versions: {
          '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
          '0.3.0': {},
        },
        'dist-tags': {
          bootstrap: '0.0.0-bootstrap.0',
          latest: '0.0.0-bootstrap.0',
        },
      },
      {
        versions: {
          '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
          '9.9.9': {},
        },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0', latest: '9.9.9' },
      },
      {
        versions: {
          '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
          '9.9.9': {},
        },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0' },
      },
      {
        versions: {
          '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
          '0.3.0-rc.1': {},
        },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0' },
      },
      {
        versions: {
          '0.0.0-bootstrap.0': {
            deprecated: bootstrapMessage,
            dependencies: { '@termwright/protocol': '0.2.0' },
          },
        },
        'dist-tags': { bootstrap: '0.0.0-bootstrap.0' },
      },
    ]) {
      await expect(
        checkNpmReleaseReadiness({
          packagesRoot: await workspace(),
          retiredPolicy: policy,
          bootstrapPolicy,
          fetchImpl: fetcher({
            inventory: {
              '@termwright/ink': 'write',
              '@termwright/ink-testing': 'write',
              '@termwright/new-package': 'write',
            },
            bootstrapPackument,
          }),
        }),
      ).rejects.toThrow(
        /bootstrap|deprecated|latest|administrative placeholder|reviewed functional release/u,
      );
    }
  });

  it('accepts a partial functional release with per-package bootstrap and stable latest states', async () => {
    const packageNames = ['@termwright/new-package', '@termwright/other-package'];
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(['@termwright/ink', ...packageNames], '0.3.0'),
        retiredPolicy: policy,
        bootstrapPolicy: { ...bootstrapPolicy, packages: packageNames },
        fetchImpl: fetcher({
          inventory: {
            '@termwright/ink': 'write',
            '@termwright/ink-testing': 'write',
            '@termwright/new-package': 'write',
            '@termwright/other-package': 'write',
          },
          bootstrapPackuments: {
            '@termwright/new-package': {
              versions: {
                '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
              },
              'dist-tags': {
                bootstrap: '0.0.0-bootstrap.0',
                latest: '0.0.0-bootstrap.0',
              },
            },
            '@termwright/other-package': {
              versions: {
                '0.0.0-bootstrap.0': { deprecated: bootstrapMessage },
                '0.3.0': {},
              },
              'dist-tags': {
                bootstrap: '0.0.0-bootstrap.0',
                latest: '0.3.0',
              },
            },
          },
        }),
      }),
    ).resolves.toContain('every public workspace package exists');
  });

  it('rejects an unreviewed package in the npm organization inventory', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({
          inventory: {
            '@termwright/ghost': 'write',
            '@termwright/ink': 'write',
            '@termwright/ink-testing': 'write',
          },
        }),
      }),
    ).rejects.toThrow(/unreviewed npm packages.*ghost/u);
  });

  it('requires the exact deprecation message on every retired version', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({
          inventory: { '@termwright/ink': 'write', '@termwright/ink-testing': 'write' },
          retiredVersions: {
            '0.1.0': { deprecated: message },
            '0.2.0': {},
          },
        }),
      }),
    ).rejects.toThrow(/must be deprecated with the exact message/u);
  });

  it('rejects a reviewed active or retired name missing from organization inventory', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({ inventory: { '@termwright/ink': 'write' } }),
      }),
    ).rejects.toThrow(/namespace inventory is missing.*ink-testing/u);
  });

  it('rejects retired names that overlap the workspace or lack an active replacement', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(['@termwright/ink', '@termwright/ink-testing']),
        retiredPolicy: policy,
        fetchImpl: fetcher({ inventory: {} }),
      }),
    ).rejects.toThrow(/still an active workspace package/u);
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(['@termwright/new-package']),
        retiredPolicy: policy,
        fetchImpl: fetcher({ inventory: {} }),
      }),
    ).rejects.toThrow(/invalid retired npm package policy entry/u);
  });

  it('fails closed when npm organization inventory is unavailable or malformed', async () => {
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({ inventory: {}, inventoryStatus: 500 }),
      }),
    ).rejects.toThrow(/inventory: registry returned HTTP 500/u);
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({ inventory: new Error('bad json') }),
      }),
    ).rejects.toThrow(/malformed JSON/u);
    await expect(
      checkNpmReleaseReadiness({
        packagesRoot: await workspace(),
        retiredPolicy: policy,
        expectedMissing: ['@termwright/new-package'],
        fetchImpl: fetcher({ inventory: [] }),
      }),
    ).rejects.toThrow(/inventory has an invalid shape/u);
  });
});
