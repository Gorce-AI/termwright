import { expect, test } from '@termwright/test';

const TERMINALS = 16;

test.resources({ terminals: TERMINALS })(
  'owns and tears down the complete stress-profile terminal budget',
  { timeout: 90_000 },
  async ({ terminal }) => {
    const launches = Array.from({ length: TERMINALS }, (_, index) => terminal.launch({
      command: [
        process.execPath,
        '-e',
        `process.stdout.write(${JSON.stringify(`stress-ready-${index}\n`)});setInterval(()=>{},1000)`,
      ],
      columns: 40,
      rows: 4,
      semantics: 'off',
    }));

    // Promise.all is intentional: acquiring one terminal at a time would not
    // prove the host can reserve a legitimate multi-terminal group without
    // deadlocking at the global budget.
    const sessions = await Promise.all(launches);
    expect(sessions).toHaveLength(TERMINALS);
    await Promise.all(sessions.map(async (session, index) => {
      await session.waitForText(`stress-ready-${index}`);
    }));

    // The fixture owns all sessions. Its post-test cleanup closes every process
    // and releases every broker lease before the runner may emit
    // attempt.finished; the host's run-finalization barrier rejects any leak.
  },
);
