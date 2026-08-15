/**
 * Generic (uninstrumented) fixture: prints a banner, sets a title and echoes
 * every keystroke as hex. Never opens the semantic endpoint, so it also proves
 * the dormant rule — the driver must settle as a generic session.
 */
process.stdout.write('\x1b]0;echo-app\x07');
process.stdout.write('READY\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text === '\x03' || text === 'q') {
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  process.stdout.write(`KEY:${hex}\r\n`);
});
