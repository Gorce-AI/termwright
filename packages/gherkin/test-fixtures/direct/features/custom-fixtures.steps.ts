import { After, Before, Given, Then, When, defineSteps } from '@termwright/gherkin';
import type { ProjectFixtures } from '../fixtures.js';

export default defineSteps<ProjectFixtures>(
  Before<ProjectFixtures>({ tags: '@project' }, async ({ projectFixture }) => {
    await Promise.resolve();
    projectFixture.events.push('before');
  }),
  Given<ProjectFixtures>(
    'the project fixture is available',
    async ({ defer, expect, projectFixture, world }) => {
      await Promise.resolve();
      expect(projectFixture.label).toBe('extended');
      world.fixture = projectFixture;
      projectFixture.events.push('given');
      defer(async () => {
        await Promise.resolve();
        projectFixture.events.push('context:cleanup');
      });
    },
  ),
  When<ProjectFixtures>(
    'the project fixture owns a scenario resource',
    async ({ projectFixture, use }) => {
      await Promise.resolve();
      projectFixture.events.push('when');
      use({
        async close() {
          await Promise.resolve();
          projectFixture.events.push('resource:close');
        },
      });
    },
  ),
  Then<ProjectFixtures>(
    'every step has received the same project fixture',
    async ({ expect, projectFixture, world }) => {
      await Promise.resolve();
      expect(world.fixture).toBe(projectFixture);
      projectFixture.events.push('then');
    },
  ),
  After<ProjectFixtures>({ tags: '@project' }, async ({ projectFixture }) => {
    await Promise.resolve();
    projectFixture.events.push('after');
  }),
);
