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

    const list = app.getByRole('list');
    expect((await list.geometry()).intendedRect.status).toBe('known');
    await expect(list.click({timeout: 0})).rejects.toThrow(/unsupported|pointer/iu);
  });
});
