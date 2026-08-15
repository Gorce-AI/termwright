/**
 * Log-file fixture: writes to a log the way a real TUI does — lazily, on first
 * write, long after start-up — and reproduces the two things that happen to log
 * files in the wild: truncation and rotation by rename.
 *
 * Keys: `w` one line, `f` a flood, `l` one very long line, `t` truncate,
 * `r` rotate, `q` quit. Input is read code point by code point, because a pty
 * routinely delivers two keystrokes as one chunk.
 */
import { appendFileSync, renameSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
let written = 0;

function line(text) {
  written += 1;
  appendFileSync(path, `${text}\n`);
}

process.stdout.write('LOG APP READY\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  for (const key of chunk.toString('utf8')) {
    if (key === 'w') line(`hello ${written + 1}`);
    else if (key === 'l') line(`long ${'x'.repeat(9000)}`);
    else if (key === 'f') {
      // One burst, not 2000 syscalls: a flood arrives faster than a tail can
      // deliver it, which is exactly what the rate limit exists for.
      const burst = Array.from({ length: 2000 }, (_, index) => `flood ${index}`);
      written += burst.length;
      appendFileSync(path, `${burst.join('\n')}\n`);
    } else if (key === 't') {
      writeFileSync(path, '');
      process.stdout.write('TRUNCATED\r\n');
    } else if (key === 'r') {
      renameSync(path, `${path}.1`);
      writeFileSync(path, '');
      process.stdout.write('ROTATED\r\n');
    } else if (key === 'q') process.exit(0);
  }
});
