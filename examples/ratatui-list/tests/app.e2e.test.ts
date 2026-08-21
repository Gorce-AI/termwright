import {existsSync} from 'node:fs';
import {describe, expect, ptyAvailable, test} from 'termwright/test';
import {binary} from '../termwright.config.js';

const runnable = process.platform !== 'win32' && (await ptyAvailable()) && existsSync(binary);
if (process.env['TERMWRIGHT_REQUIRE_EXAMPLES'] === '1' && !runnable) {
  throw new Error('Ratatui example requires Rust on macOS/Linux and a working pseudo-terminal');
}

describe.skipIf(!runnable)('the Ratatui release list', () => {
  test('observes the selected row after keyboard navigation', async ({terminal}) => {
    const app = await terminal.launch();
    await app.waitForText('Release status');

    await expect(app.getByRole('listitem', {name: 'Draft'})).toHaveState({selected: true});
    await app.press('ArrowDown');
    await expect(app.getByRole('listitem', {name: 'Ready'})).toHaveState({selected: true});

    const list = app.getByRole('list', {name: 'Release status'});
    expect((await list.geometry()).intendedRect.status).toBe('known');
    const receipt = await list.click({position: {rowOffset: 3, columnOffset: 4}});
    await expect(app.getByRole('listitem', {name: 'Shipped'})).toHaveState({selected: true});
    expect(receipt.plan?.strategy).toBe('authoritative-pointer-region');
    expect(receipt.executed.map((step) => `${step.device}:${step.kind}`)).toEqual([
      'mouse:down',
      'mouse:up',
    ]);
    expect(app.contract()?.capabilities['pointer-hit-testing']).toMatchObject({
      status: 'supported',
      evidence: {providerId: 'ratatui-list-production-router'},
    });
  });
});
