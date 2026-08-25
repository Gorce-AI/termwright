import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { changedFiles, changesetDecision, isConsumableChangesetPath, isPublishablePackagePath } from './check-pr-changeset.mjs';

const execFile = promisify(execFileCallback);

describe('pull-request changeset policy', () => {
  it.each([
    'packages/probe-opentui/src/instrumentation.test.ts',
    'packages/ui/src/app/browser-client.spec.ts',
    'packages/driver/tests/session.ts',
    'packages/test/vitest.config.ts',
    'packages/test/coverage.config.mjs',
    'packages/test/src/output.snap',
    'packages/test/README.md',
  ])('does not version test or documentation input %s', (path) => {
    expect(isPublishablePackagePath(path)).toBe(false);
  });

  it.each([
    'packages/driver/src/session.ts',
    'packages/driver/package.json',
    'packages/ui/src/app.tsx',
    'packages/test/src/index.ts',
    'packages/test/package.json',
    'packages/conformance/src/fixtures/generic-app.mjs',
    'packages/driver/src/__fixtures__/application.ts',
  ])('requires a release decision for publishable input %s', (path) => {
    expect(isPublishablePackagePath(path)).toBe(true);
  });

  it('requires a changeset only when publishable package contents lack one', () => {
    const paths = ['packages/driver/src/session.ts', 'packages/driver/src/session.test.ts'];
    expect(changesetDecision(paths, [])).toEqual({ publishable: ['packages/driver/src/session.ts'], needsChangeset: true });
    expect(changesetDecision(paths, ['.changeset/session.md']).needsChangeset).toBe(false);
    expect(changesetDecision(['packages/driver/src/session.test.ts'], []).needsChangeset).toBe(false);
    expect(changesetDecision([
      'packages/driver/src/session.ts',
      'packages/driver/src/session.test.ts',
    ], []).publishable).toEqual(['packages/driver/src/session.ts']);
  });

  it('accepts only direct changeset files consumed by the release workflow', () => {
    expect(isConsumableChangesetPath('.changeset/session-fix.md')).toBe(true);
    expect(isConsumableChangesetPath('.changeset/README.md')).toBe(false);
    expect(isConsumableChangesetPath('.changeset/nested/fake.md')).toBe(false);
    expect(isConsumableChangesetPath('.changeset/.fake.md')).toBe(false);
  });

  it('reports both sides when production code is renamed to a test-looking path', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'tw-changeset-rename-'));
    try {
      await execFile('git', ['init', '--quiet'], { cwd: scratch });
      await execFile('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: scratch });
      await execFile('git', ['config', 'user.name', 'CI'], { cwd: scratch });
      const source = join(scratch, 'packages/example/src/api.ts');
      await mkdir(join(scratch, 'packages/example/src'), { recursive: true });
      await writeFile(source, 'export const api = true;\n');
      await execFile('git', ['add', '.'], { cwd: scratch });
      await execFile('git', ['commit', '--quiet', '-m', 'base'], { cwd: scratch });
      await rename(source, join(scratch, 'packages/example/src/api.test.ts'));
      await execFile('git', ['add', '-A'], { cwd: scratch });
      await execFile('git', ['commit', '--quiet', '-m', 'rename'], { cwd: scratch });

      const paths = await changedFiles('HEAD^', 'HEAD', [], scratch);
      expect(paths).toEqual(['packages/example/src/api.test.ts', 'packages/example/src/api.ts']);
      expect(changesetDecision(paths, []).needsChangeset).toBe(true);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
