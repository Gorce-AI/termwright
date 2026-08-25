const chunk = 'f'.repeat(8 * 1024);
process.stdin.setRawMode?.(true);
process.stdin.resume();

const terminalAcknowledged = new Promise((resolve) => {
  let input = '';
  process.stdin.on('data', (data) => {
    input += data.toString('utf8');
    if (/\x1b\[\d+;\d+R/u.test(input)) resolve();
  });
});

for (let index = 0; index < 128; index += 1) {
  if (!process.stdout.write(`${chunk}\n`)) {
    await new Promise((resolve) => process.stdout.once('drain', resolve));
  }
}
// Wait for the sentinel to leave this process before exiting. The test proves
// the driver delivers everything the child wrote; a child that exits with its
// own stdout buffer still full loses the line before the driver ever sees it,
// which on a loaded runner looked like a broken drain boundary.
await new Promise((resolve) => {
  if (process.stdout.write('FINAL OUTPUT SENTINEL\n')) resolve();
  else process.stdout.once('drain', resolve);
});

// Linux node-pty/libuv cannot prove that POLLHUP was observed only after the
// PTY master drained. A DSR reply is a causal acknowledgement from Termwright's
// emulator: it can be generated only after every preceding byte, including the
// sentinel, reached and was parsed by the driver. Keep the slave alive until
// that acknowledgement arrives, without a sleep, retry or timing assumption.
process.stdout.write('\x1b[6n');
await terminalAcknowledged;
process.stdin.pause();
