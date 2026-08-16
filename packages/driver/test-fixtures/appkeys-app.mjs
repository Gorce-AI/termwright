/**
 * Application-keys fixture: switches the cursor keys and the keypad into
 * application mode, then reports the bytes it receives as hex.
 *
 * It answers the input-direction half of the question the escape table raises.
 * If a terminal consumes `CSI ? 1 h` on its way out, the driver cannot know the
 * program wants `ESC O A` for Up — but the program still wants it. Whether that
 * is harmless depends on what the terminal does with the bytes we write back,
 * and only the child can say what it actually received.
 */
process.stdout.write('\x1b[?1h\x1b=');
process.stdout.write('APPKEYS ON\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  if (chunk.includes(0x03) || chunk.toString('utf8') === 'q') {
    process.stdout.write('\x1b>\x1b[?1l');
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  process.stdout.write(`GOT:${hex}\r\n`);
});
