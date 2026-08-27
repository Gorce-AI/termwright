import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const verifier = fileURLToPath(
  new URL('../packages/conformance/scripts/verify-tview-fixture.mjs', import.meta.url),
);
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tw-tview-contract-test-'));
  roots.push(root);
  const instrumented = join(root, 'instrumented');
  const baseline = join(root, 'baseline');
  await writeFile(instrumented, 'instrumented', 'utf8');
  await writeFile(baseline, 'baseline', 'utf8');
  await chmod(instrumented, 0o755);
  await chmod(baseline, 0o755);
  const digest = async (path) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const contract = join(root, 'contract.json');
  const value = {
    schemaVersion: 1,
    platform: platform(),
    arch: arch(),
    binaries: {
      instrumented: { file: 'instrumented', sha256: await digest(instrumented) },
      baseline: { file: 'baseline', sha256: await digest(baseline) },
    },
  };
  const publish = () => writeFile(contract, `${JSON.stringify(value)}\n`, 'utf8');
  await publish();
  return { root, instrumented, baseline, contract, value, publish };
}

async function verify(subject, instrumented = subject.instrumented, baseline = subject.baseline) {
  return run(process.execPath, [verifier, subject.contract, instrumented, baseline]);
}

describe('the pre-host tview fixture verifier', () => {
  it('accepts the exact platform-bound, content-addressed launch artifacts', async () => {
    await expect(verify(await fixture())).resolves.toMatchObject({ stderr: '' });
  });

  it('rejects a changed binary digest', async () => {
    const subject = await fixture();
    await writeFile(subject.instrumented, 'tampered', 'utf8');
    await expect(verify(subject)).rejects.toThrow(/digest does not match/u);
  });

  it('rejects a contract for another platform', async () => {
    const subject = await fixture();
    subject.value.platform = platform() === 'win32' ? 'linux' : 'win32';
    await subject.publish();
    await expect(verify(subject)).rejects.toThrow(/artifact targets/u);
  });

  it('rejects a launch path other than the verified artifact', async () => {
    const subject = await fixture();
    const substitute = join(subject.root, 'substitute');
    await writeFile(substitute, 'instrumented', 'utf8');
    await chmod(substitute, 0o755);
    await expect(verify(subject, substitute)).rejects.toThrow(/launch path does not match/u);
  });

  it('rejects a contract path that escapes the private fixture directory', async () => {
    const subject = await fixture();
    subject.value.binaries.instrumented.file = '../outside';
    await subject.publish();
    await expect(verify(subject)).rejects.toThrow(/escapes the fixture directory/u);
  });
});
