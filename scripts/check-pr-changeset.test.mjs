import { describe, expect, it } from 'vitest';
import {
  changedConsumableChangesets,
  changedFiles,
  changesetDecision,
  isConsumableChangesetPath,
  isPublishablePackagePath,
} from './check-pr-changeset.mjs';

describe('pull-request changeset policy', () => {
  it.each([
    'packages/probe-opentui/src/runtime-observer.test.ts',
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
    expect(changesetDecision(paths, [])).toEqual({
      publishable: ['packages/driver/src/session.ts'],
      needsChangeset: true,
    });
    expect(changesetDecision(paths, ['.changeset/session.md']).needsChangeset).toBe(false);
    expect(changesetDecision(['packages/driver/src/session.test.ts'], []).needsChangeset).toBe(
      false,
    );
    expect(
      changesetDecision(
        ['packages/driver/src/session.ts', 'packages/driver/src/session.test.ts'],
        [],
      ).publishable,
    ).toEqual(['packages/driver/src/session.ts']);
  });

  it('accepts a modified accumulator changeset for later compatibility batches', () => {
    expect(
      changesetDecision(
        ['packages/probe-opentui/src/certified-runtime.json'],
        ['.changeset/framework-compatibility-auto.md'],
      ).needsChangeset,
    ).toBe(false);
  });

  it('considers added and modified changesets but excludes deleted ones at the git boundary', async () => {
    const invocations = [];
    const runGit = async (...invocation) => {
      invocations.push(invocation);
      return {
        stdout:
          '.changeset/new.md\0.changeset/framework-compatibility-auto.md\0.changeset/README.md\0.changeset/nested/fake.md\0',
      };
    };

    await expect(changedConsumableChangesets('BASE', 'HEAD', '/repo', runGit)).resolves.toEqual([
      '.changeset/new.md',
      '.changeset/framework-compatibility-auto.md',
    ]);
    expect(invocations).toEqual([
      [
        'git',
        ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=AM', 'BASE', 'HEAD', '--'],
        { cwd: '/repo' },
      ],
    ]);
  });

  it('accepts only direct changeset files consumed by the release workflow', () => {
    expect(isConsumableChangesetPath('.changeset/session-fix.md')).toBe(true);
    expect(isConsumableChangesetPath('.changeset/README.md')).toBe(false);
    expect(isConsumableChangesetPath('.changeset/nested/fake.md')).toBe(false);
    expect(isConsumableChangesetPath('.changeset/.fake.md')).toBe(false);
  });

  it('disables rename detection and preserves both NUL-delimited sides', async () => {
    const invocations = [];
    const runGit = async (...invocation) => {
      invocations.push(invocation);
      return { stdout: 'packages/example/src/api.test.ts\0packages/example/src/api.ts\0' };
    };

    const paths = await changedFiles('BASE', 'HEAD', ['--diff-filter=AMD'], '/repo', runGit);

    expect(invocations).toEqual([
      [
        'git',
        ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=AMD', 'BASE', 'HEAD', '--'],
        { cwd: '/repo' },
      ],
    ]);
    expect(paths).toEqual(['packages/example/src/api.test.ts', 'packages/example/src/api.ts']);
    expect(changesetDecision(paths, []).needsChangeset).toBe(true);
  });
});
