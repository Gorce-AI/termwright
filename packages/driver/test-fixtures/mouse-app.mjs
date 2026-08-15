/**
 * Mouse fixture: enables VT200 tracking plus SGR encoding and reports every
 * decoded mouse report. Used to prove that a `click()` reaches the child as the
 * bytes a real terminal would send.
 */
process.stdout.write('\x1b[?1000h\x1b[?1006h');
process.stdout.write('MOUSE ON\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text === '\x03' || text === 'q') {
    process.stdout.write('\x1b[?1006l\x1b[?1000l');
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  const sgr = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/gu;
  let seen = false;
  for (const match of text.matchAll(sgr)) {
    seen = true;
    const [, button, column, row, final] = match;
    process.stdout.write(
      `MOUSE ${final === 'M' ? 'press' : 'release'} b=${button} c=${column} r=${row}\r\n`,
    );
  }
  if (!seen) {
    const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    process.stdout.write(`RAW:${hex}\r\n`);
  }
});
