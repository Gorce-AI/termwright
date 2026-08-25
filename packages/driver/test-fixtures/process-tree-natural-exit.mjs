import { spawn } from 'node:child_process';

// The root exits first. A backend may publish terminal exit only after this
// still-owned console/process-group member is also gone; otherwise
// TerminalSession would release ownership while a descendant survives.
const grandchild = spawn(process.execPath, ['-e', `
  setInterval(() => {}, 60000);
`], { stdio: 'ignore' });

process.stdout.write(`NATURAL TREE READY parent=${process.pid} grandchild=${grandchild.pid}\n`, () => {
  process.exit(0);
});
