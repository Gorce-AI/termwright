/**
 * Shell-integration fixture: emits OSC 133 prompt marks the way an integrated
 * shell does — `A` prompt start, `B` input start, `C` command start,
 * `D;<code>` command finished — so `waitForReady` can use them instead of
 * guessing from silence.
 */
const OSC = (payload) => process.stdout.write(`\x1b]133;${payload}\x07`);

function prompt() {
  OSC('A');
  process.stdout.write('$ ');
  OSC('B');
}

// A slow start: the prompt only appears after the banner, so a test that
// asserts readiness cannot pass by accident on the first byte.
process.stdout.write('booting\r\n');
setTimeout(prompt, 120);

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text === 'q' || text === '\x03') process.exit(0);
  OSC('C');
  process.stdout.write('\r\nworking\r\n');
  setTimeout(() => {
    OSC('D;0');
    prompt();
  }, 120);
});
