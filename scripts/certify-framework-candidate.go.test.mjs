import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect } from 'vitest';
import { it as resourceAwareIt } from '../packages/resource-broker/src/vitest.ts';
import { bindLocalTermwrightGoClient } from './certify-framework-candidate.mjs';
import { goTestCapability } from './test-support/go-toolchain.mjs';

const run = promisify(execFile);
const goIt = resourceAwareIt.resources({ hostPressure: 'exclusive' });
const roots = [];

const hasGo = await goTestCapability(
  async () => {
    await run('go', ['version']);
    return true;
  },
  false,
  'Go certification toolchain',
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

goIt.runIf(hasGo)(
  'applies and verifies the local Termwright client replacement with the real Go toolchain',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-go-client-replace-integration-'));
    roots.push(directory);
    const client = join(directory, 'client');
    const app = join(directory, 'app');
    await Promise.all([mkdir(client), mkdir(app)]);
    await writeFile(
      join(client, 'go.mod'),
      'module github.com/gorce-ai/termwright/clients/go\n\ngo 1.22\n',
    );
    await writeFile(
      join(app, 'go.mod'),
      'module example.com/candidate\n\ngo 1.22\n\nrequire github.com/gorce-ai/termwright/clients/go v0.0.0\n',
    );

    await expect(bindLocalTermwrightGoClient(app, process.env, client)).resolves.toBeTruthy();
  },
);
