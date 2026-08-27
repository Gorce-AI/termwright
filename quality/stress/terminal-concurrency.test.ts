import { expect, test } from '@termwright/test';
import {
  publishQualityReady,
  qualityCheckpointIsConfigured,
  readQualityCheckpointFromEnvironment,
  waitForQualityTerminal,
} from '../../scripts/quality-performance-checkpoint.mjs';

const TERMINALS = 16;

test.resources({ terminals: TERMINALS })(
  'owns and tears down the complete stress-profile terminal budget',
  { timeout: 90_000 },
  async ({ terminal }) => {
    const launches = Array.from({ length: TERMINALS }, (_, index) =>
      terminal.launch({
        command: [
          process.execPath,
          '-e',
          `process.stdout.write(${JSON.stringify(`stress-ready-${index}:`)}+process.pid+'\\n');setInterval(()=>{},1000)`,
        ],
        columns: 40,
        rows: 4,
        semantics: 'off',
      }),
    );

    // Promise.all is intentional: acquiring one terminal at a time would not
    // prove the host can reserve a legitimate multi-terminal group without
    // deadlocking at the global budget.
    const sessions = await Promise.all(launches);
    expect(sessions).toHaveLength(TERMINALS);
    const processPids = await Promise.all(
      sessions.map(async (session, index) => {
        const marker = new RegExp(`stress-ready-${index}:(\\d+)\\b`, 'u');
        await session.waitForText(marker);
        const match = marker.exec(session.screen().text());
        const pid = Number(match?.[1]);
        expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
        return pid;
      }),
    );
    expect(new Set(processPids).size).toBe(TERMINALS);

    if (qualityCheckpointIsConfigured()) {
      const checkpoint = await readQualityCheckpointFromEnvironment();
      await publishQualityReady(checkpoint, processPids);
      // This is a failure/cleanup ceiling, not a success fallback: if the
      // collector disappears, fixture ownership must still tear down all 16
      // sessions before Vitest's outer 90-second case boundary.
      const terminal = await waitForQualityTerminal(checkpoint, {
        signal: AbortSignal.timeout(30_000),
      });
      if (terminal.status === 'failure') {
        throw new Error(`quality snapshot failed: ${terminal.message}`);
      }
      expect(terminal.sessions).toBe(TERMINALS);
      expect(terminal.processCount).toBeGreaterThanOrEqual(TERMINALS + 2);
    }

    // The fixture owns all sessions. Its post-test cleanup closes every process
    // and releases every broker lease before the runner may emit
    // attempt.finished; the host's run-finalization barrier rejects any leak.
  },
);
