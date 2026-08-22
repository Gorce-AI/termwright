import { spawn } from 'node:child_process';

process.on('SIGHUP', () => undefined);
process.on('SIGTERM', () => undefined);

const grandchild = spawn(process.execPath, ['-e', `
  process.on('SIGHUP', () => undefined);
  process.on('SIGTERM', () => undefined);
  setInterval(() => undefined, 60_000);
`], { stdio: 'inherit' });

process.stdout.write(`PROCESS TREE READY parent=${process.pid} grandchild=${grandchild.pid}\n`);
setInterval(() => undefined, 60_000);
