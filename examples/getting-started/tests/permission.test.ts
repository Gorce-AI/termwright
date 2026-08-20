import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';

const program = fileURLToPath(new URL('../app.js', import.meta.url));

test('approves a command', async ({terminal}) => {
  const app = await terminal.launch({command: [process.execPath, program]});

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('running: ls -la');
});
