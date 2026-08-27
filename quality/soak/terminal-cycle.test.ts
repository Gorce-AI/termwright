import { expect, test } from '@termwright/test';

test(
  'launches, observes and transactionally tears down one terminal cycle',
  { timeout: 30_000 },
  async ({ terminal }) => {
    const app = await terminal.launch({
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('soak-ready\\n');setInterval(()=>{},1000)",
      ],
      columns: 32,
      rows: 4,
      semantics: 'off',
    });
    await app.waitForText('soak-ready');
    expect(app.screen().text()).toContain('soak-ready');
    // Fixture teardown is the assertion boundary for process death, journal
    // completion, trace closure and broker lease release.
  },
);
