import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';

const execFileAsync = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });

describe('Ink React bridge under Bun', () => {
  it('observes a real committed Ink containerInfo without a skipped compatibility path', async () => {
    const bridgeUrl = new URL('./react-commit-bridge.ts', import.meta.url).href;
    const inkUrl = import.meta.resolve('ink');
    const reconcilerUrl = inkUrl.replace(/index\.js$/u, 'reconciler.js');
    const script = `
      import {PassThrough} from 'node:stream';
      import {createElement} from 'react';
      import {activateInkRendererObservation} from ${JSON.stringify(bridgeUrl)};
      const ink = await import(${JSON.stringify(inkUrl)});
      const reconciler = (await import(${JSON.stringify(reconcilerUrl)})).default;
      const bridge = activateInkRendererObservation(reconciler);
      const commits = [];
      const release = bridge.subscribe(event => {
        if (event.type === 'commit') commits.push({
          same: event.fiberRoot.containerInfo === event.root,
          nodeName: event.root.nodeName,
        });
      });
      const stdout = new PassThrough();
      Object.defineProperties(stdout, {
        columns: {value: 20}, rows: {value: 8}, isTTY: {value: true},
      });
      const instance = ink.render(createElement(ink.Text, null, 'bun-bridge'), {
        stdout, patchConsole: false, interactive: true,
      });
      await instance.waitUntilRenderFlush();
      instance.unmount();
      await instance.waitUntilExit();
      release();
      console.log(JSON.stringify(commits));
    `;
    const { stdout, stderr } = await execFileAsync('bun', ['--eval', script], {
      cwd: fileURLToPath(new URL('.', inkUrl)),
    });
    expect(stderr).toBe('');
    const commits = JSON.parse(stdout) as Array<{
      same: boolean;
      nodeName: string;
    }>;
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.at(-1)).toEqual({ same: true, nodeName: 'ink-root' });
  });
});
