/**
 * Generic (uninstrumented) fixture: prints a banner, sets a title and echoes
 * every keystroke as hex. Never opens the semantic endpoint, so it also proves
 * the dormant rule — the driver must settle as a generic session.
 */
process.stdout.write('\x1b]0;echo-app\x07');
process.stdout.on('resize', () => {
  process.stdout.write(`SIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`);
});

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text.includes('\x03') || text.includes('q')) {
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  process.stdout.write(`KEY:${hex}\r\n`);
});

// READY is a causal input-readiness boundary, not merely an output banner.
// In particular, ConPTY must not receive Ctrl+C while processed input is still
// active and before the application has installed the handler that consumes it.
process.stdout.write('READY\r\n');
