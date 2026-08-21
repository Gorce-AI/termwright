import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withProbe} from '@termwright/probe-opentui';
import {describe, expect, ptyAvailable, test} from 'termwright/test';

const application = fileURLToPath(new URL('../app/form.ts', import.meta.url));
const command = withProbe('bun', ['bun', application]).command;
const hasBun = spawnSync('bun', ['--version'], {stdio: 'ignore'}).status === 0;
const runnable = hasBun && (await ptyAvailable());
if (process.env['TERMWRIGHT_REQUIRE_EXAMPLES'] === '1' && !runnable) {
  throw new Error('OpenTUI example requires Bun and a working pseudo-terminal');
}

describe.skipIf(!runnable)('the OpenTUI release form', () => {
  test('submits a focused field through real terminal input', async ({terminal}) => {
    const app = await terminal.launch({command});

    await expect(app.getByRole('textbox')).toBeFocused();
    await app.type('v1.0.0');
    await expect(app.getByRole('textbox')).toHaveText('v1.0.0');

    await app.press('Enter');
    await expect(app).toHaveText('status: created v1.0.0');

    const field = app.getByRole('textbox');
    expect((await field.geometry()).intendedRect.status).toBe('known');
    expect((await field.hitTest()).receivesEvents).toMatchObject({status: 'known', value: true});
  });
});
