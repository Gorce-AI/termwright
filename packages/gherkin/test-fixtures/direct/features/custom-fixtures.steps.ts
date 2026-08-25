import { After, Before, Given, defineSteps } from '@termwright/gherkin';
import type { ProjectFixtures } from '../fixtures.js';

export default defineSteps<ProjectFixtures>(
  Before<ProjectFixtures>(({ projectFixture }) => {
    projectFixture.events.push('before');
  }),
  Given<ProjectFixtures>('the project fixture is available', ({ defer, expect, projectFixture }) => {
    expect(projectFixture.label).toBe('extended');
    projectFixture.events.push('step');
    defer(() => projectFixture.events.push('context:cleanup'));
  }),
  After<ProjectFixtures>(({ projectFixture }) => {
    projectFixture.events.push('after');
  }),
);
