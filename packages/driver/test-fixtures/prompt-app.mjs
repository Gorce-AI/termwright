/**
 * Shell-integration fixture: emits OSC 133 prompt marks the way an integrated
 * shell does — `A` prompt start, `B` input start, `C` command start,
 * `D;<code>` command finished — so `waitForReady` can use them instead of
 * guessing from silence.
 */
const OSC = (payload) => process.stdout.write(`\x1b]133;${payload}\x07`);

// `--exit-after-prompt` leaves a prompt on screen and then exits, so a test
// can tell "a prompt is visible" apart from "the program can take input".
const exitAfterPrompt = process.argv.includes('--exit-after-prompt');

function prompt() {
  OSC('A');
  process.stdout.write('$ ');
  OSC('B');
  if (exitAfterPrompt) process.exit(0);
}

// The banner and the first prompt land in one frame. Delaying the prompt would
// race the settled-screen fallback: a program that stays silent long enough is
// called ready by the heuristic before its marks ever arrive, which is correct
// behaviour and makes for a flaky test.
process.stdout.write('booting\r\n');
prompt();

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
