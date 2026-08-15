/**
 * A shell-shaped fixture for `waitForReady`.
 *
 * It emits the OSC 133 shell-integration marks that VS Code, iTerm2, WezTerm
 * and fish already agree on, so the driver's preferred readiness strategy has
 * something real to read:
 *
 *   `OSC 133 ; A`  prompt starts      `OSC 133 ; C`  command starts
 *   `OSC 133 ; B`  input starts       `OSC 133 ; D ; <code>`  command finished
 *
 * It is deliberately not a shell: a real one would drag its own startup files,
 * prompt and locale into the assertion. Commands:
 *
 *   `hang`   emits C and never D — the "still running" timeout case
 *   `quit`   exits 0
 *   anything else runs for `--work=<ms>` (default 200) and finishes with D;0
 *   `fail`   finishes with D;3, so a non-zero status is observable
 *
 * Pass `--marks=off` to emit no marks at all: same screen, same timing, but the
 * driver has to fall back to its settled-screen heuristic.
 */

const workArg = process.argv.find((argument) => argument.startsWith('--work='));
const work = workArg === undefined ? 200 : Number(workArg.slice('--work='.length));
const marks = !process.argv.includes('--marks=off');

let line = '';
let running = false;

const out = (text) => process.stdout.write(text);
const mark = (payload) => {
  if (marks) out(`\x1b]133;${payload}\x07`);
};

function prompt() {
  mark('A');
  out('$ ');
  mark('B');
}

function finish(code) {
  running = false;
  mark(`D;${code}`);
  out('\r\n');
  prompt();
}

function run(command) {
  running = true;
  mark('C');
  out('\r\n');
  // Announced before the work starts, so a test can wait for "the command is
  // running" without racing the mark it is trying to observe.
  out(`RUNNING ${command}\r\n`);

  if (command === 'hang') {
    // Emits C and never D: a command that is still running is not readiness,
    // and the driver must say so rather than time out silently.
    out('HANGING\r\n');
    return;
  }
  const timer = setTimeout(() => {
    out(`ran ${command}\r\n`);
    finish(command === 'fail' ? 3 : 0);
  }, work);
  timer.unref?.();
}

process.stdout.write('\x1b]0;prompt-app\x07');
process.stdout.write('PROMPT APP\r\n');
prompt();

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString('utf8')) {
    if (character === '\r' || character === '\n') {
      const command = line.trim();
      line = '';
      if (command === 'quit') {
        out('\r\nBYE\r\n');
        process.exit(0);
      }
      if (running) continue; // a busy shell does not take a new command
      run(command.length === 0 ? 'nothing' : command);
      continue;
    }
    if (character === '\x7f') {
      line = line.slice(0, -1);
      continue;
    }
    if (character >= ' ') {
      line += character;
      out(character);
    }
  }
});
