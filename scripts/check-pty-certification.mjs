#!/usr/bin/env node

import { createNativePtyBackend, inheritedSpawnEnv } from '../packages/driver/dist/experimental.js';

const payloadBytes = 1024 * 1024;
const sentinel = Buffer.from('TERMWRIGHT_NATIVE_PTY_FINAL_SENTINEL');
const source = [
  "const fs = require('node:fs');",
  `const block = Buffer.alloc(${payloadBytes}, 0x78);`,
  'let offset = 0;',
  'while (offset < block.length) offset += fs.writeSync(1, block, offset);',
  `fs.writeSync(1, Buffer.from(${JSON.stringify(sentinel.toString('utf8'))}));`,
].join('');

const processHandle = createNativePtyBackend().spawn({
  command: [process.execPath, '-e', source],
  env: inheritedSpawnEnv(),
  columns: 80,
  rows: 24,
});
const chunks = [];
processHandle.onData((data) => chunks.push(Buffer.from(data)));
const exited = new Promise((resolve) => processHandle.onExit(resolve));

try {
  const [status] = await Promise.all([exited, processHandle.outputEnded]);
  const output = Buffer.concat(chunks);
  if (status.code !== 0 || status.signal !== null) {
    throw new Error(`native PTY child failed: ${JSON.stringify(status)}`);
  }
  if (processHandle.lifecycle?.outputDrain !== 'eof' || processHandle.sawOutputEnd?.() !== true) {
    throw new Error('native PTY did not certify a real end of output');
  }
  const sentinelOffset = output.lastIndexOf(sentinel);
  const payloadOffset = sentinelOffset - payloadBytes;
  if (sentinelOffset < payloadBytes ||
      !output.subarray(payloadOffset, sentinelOffset).equals(Buffer.alloc(payloadBytes, 0x78))) {
    throw new Error(`native PTY lost its final output: received ${output.length} bytes`);
  }
  if (processHandle.treeState?.() !== 'gone') {
    throw new Error('native PTY process tree was not proven gone after EOF');
  }
  console.log(
    `native PTY certification: ${process.platform}-${process.arch}, ` +
      `${output.length} bytes drained to EOF`,
  );
} finally {
  processHandle.dispose();
}
