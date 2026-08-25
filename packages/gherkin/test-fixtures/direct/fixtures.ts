import { describe, expect, test as base } from '@termwright/test';

export { describe, expect };

export interface ProjectFixtures {
  readonly projectFixture: {
    readonly label: string;
    readonly events: string[];
  };
}

export const test = base.extend<ProjectFixtures>({
  projectFixture: async ({ terminal }, use) => {
    const events = ['fixture:setup'];
    await use({ label: 'extended', events });
    if (events.length > 1) {
      events.push('fixture:teardown');
      expect(events).toEqual([
        'fixture:setup',
        'before',
        'step',
        'after',
        'context:cleanup',
        'fixture:teardown',
      ]);
    }
    // The custom fixture depends on the native terminal fixture, whose
    // teardown must therefore still be pending here.
    expect(terminal.sessions).toEqual([]);
  },
});
