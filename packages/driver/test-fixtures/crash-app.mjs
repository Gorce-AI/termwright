/**
 * Crash fixture: dies the two ways a program dies on its own — an uncaught
 * exception (stack trace on stderr, exit code 1) and a fatal signal. Also
 * exits cleanly on demand, so "clean exit is not a crash" can be asserted
 * against the same program.
 */
process.stdout.write('CRASH APP READY\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
// A pty coalesces writes: two press() calls routinely arrive as one chunk, so
// each code point is handled on its own. Comparing the whole chunk would make
// the second key of any pair silently disappear.
process.stdin.on('data', (chunk) => {
  for (const key of chunk.toString('utf8')) {
    if (key === 'x') {
      // Uncaught: node prints the stack to stderr and exits with code 1.
      setTimeout(() => {
        throw new Error('boom from the fixture');
      }, 0);
      return;
    }
    if (key === 'k') {
      process.kill(process.pid, 'SIGKILL');
      return;
    }
    if (key === 'e') {
      process.stdout.write('LEAVING\r\n');
      process.exit(0);
    }
  }
});
