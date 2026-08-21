import {existsSync} from 'node:fs';
import {describe, expect, ptyAvailable, test} from 'termwright/test';
import {binary} from '../termwright.config.js';

const runnable = (await ptyAvailable()) && existsSync(binary);
if (process.env['TERMWRIGHT_REQUIRE_EXAMPLES'] === '1' && !runnable) {
  throw new Error('Bubble Tea example requires Go, a built binary, and a working pseudo-terminal');
}

describe.skipIf(!runnable)('the Bubble Tea login form', () => {
  test('tracks focus and values that are not recoverable from screen text', async ({terminal}) => {
    const app = await terminal.launch();
    await app.waitForText('Sign in');

    const name = app.getByRole('textbox', {name: 'Name'});
    const password = app.getByRole('textbox', {name: 'Password'});
    await expect(name).toBeFocused();

    await app.type('Ada');
    await expect(name).toHaveText('Ada');

    await app.press('Tab');
    await expect(password).toBeFocused();
    await app.type('secret');
    await expect(app).not.toHaveText('secret');
    expect(JSON.stringify(app.semanticTree())).not.toContain('secret');
  });
});
