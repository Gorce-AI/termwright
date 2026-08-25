import { resolve } from 'node:path';
import { afterAll } from 'vitest';
import { describe, expect, test as base, type TermwrightFixtures } from '@termwright/test';

export { describe, expect };

export interface ProjectFixtures {
  readonly projectFixture: {
    readonly label: string;
    readonly events: string[];
  };
}

type ProjectSession = Awaited<ReturnType<TermwrightFixtures['terminal']['launch']>>;

const sessions: ProjectSession[] = [];
const semanticApp = resolve(import.meta.dirname, '../../../driver/test-fixtures/semantic-app.mjs');

afterAll(async () => {
  // `afterAll` runs only after every native per-test fixture graph has torn
  // down. Each write must therefore observe the close performed by the
  // terminal fixture after its dependent project fixture returned.
  expect(sessions).not.toHaveLength(0);
  for (const session of sessions) {
    await expect(session.write('post-teardown probe')).rejects.toThrow(/closed/u);
  }
});

export const test = base.extend<ProjectFixtures>({
  projectFixture: async ({ terminal }, use) => {
    await Promise.resolve();
    const session = await terminal.launch({ command: [process.execPath, semanticApp] });
    await session.waitForText('Permission required');
    sessions.push(session);
    const events = ['fixture:setup'];
    await use({ label: 'extended', events });
    await Promise.resolve();
    // The custom fixture is a dependent of `terminal`, so its teardown still
    // has a live real session. The afterAll assertion proves the other half of
    // the edge: the terminal fixture closes it after this callback returns.
    await expect(session).toHaveText('Permission required');
    events.push('fixture:teardown');
    expect(events).toEqual(events.includes('given')
      ? [
        'fixture:setup',
        'before',
        'given',
        'when',
        'then',
        'after',
        'resource:close',
        'context:cleanup',
        'fixture:teardown',
      ]
      : ['fixture:setup', 'fixture:teardown']);
    expect(terminal.sessions).toContain(session);
  },
});
