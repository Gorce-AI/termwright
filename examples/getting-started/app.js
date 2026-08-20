import readline from 'node:readline';

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode?.(true);

process.stdout.write('Permission required\n[Approve]  Reject\n');
process.stdin.once('keypress', (_input, key) => {
  if (key.name === 'return') {
    process.stdout.write('running: ls -la\n');
    process.exit(0);
  }
});
