/**
 * A perfectly ordinary OpenTUI application.
 *
 * Read it as the proof it is meant to be: there is no termwright import, no
 * configuration, no annotation, no hook. It is what someone would write having
 * never heard of this project — which is the only kind of application the
 * zero-config claim is about.
 *
 * Env: TW_APP_STEPS — how many mutations to perform before exiting.
 */

import {
  createCliRenderer,
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  TextTableRenderable,
  white,
} from '@opentui/core';
import { writeSync } from 'node:fs';
import { PassThrough } from 'node:stream';

const steps = Number(process.env['TW_APP_STEPS'] ?? 2);
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
let wrappedWriteCalls = 0;
let wrappedWrite: typeof process.stdout.write | undefined;
if (process.env['TW_WRAP_STDOUT_WRITE'] === '1') {
  wrappedWrite = function (...args: Parameters<typeof process.stdout.write>) {
    wrappedWriteCalls += 1;
    return Reflect.apply(originalStdoutWrite, process.stdout, args) as boolean;
  } as typeof process.stdout.write;
  process.stdout.write = wrappedWrite;
}
const applicationStdout =
  process.env['TW_CUSTOM_STDOUT'] === '1'
    ? Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 })
    : undefined;
applicationStdout?.pipe(process.stdout);

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 30,
  ...(applicationStdout === undefined
    ? {}
    : { stdout: applicationStdout as unknown as NodeJS.WriteStream }),
});

if (process.env['TW_STDOUT_IDENTITY_ORACLE'] === '1') {
  const observable = renderer as unknown as { readonly stdout: unknown };
  writeSync(
    3,
    `${JSON.stringify({ stdoutIsProcessStdout: observable.stdout === process.stdout })}\n`,
  );
}
if (process.env['TW_WRAP_STDOUT_WRITE'] === '1') {
  const observable = renderer as unknown as { readonly realStdoutWrite: unknown };
  writeSync(
    3,
    `${JSON.stringify({ rendererCapturedWrapper: observable.realStdoutWrite === wrappedWrite })}\n`,
  );
}

const panel = new BoxRenderable(renderer, {
  id: 'panel',
  border: true,
  width: 44,
  height: 22,
  flexDirection: 'column',
});
const label = new TextRenderable(renderer, { id: 'label', content: 'Approve', height: 1 });
const field = new InputRenderable(renderer, { id: 'field', value: '' });
const choice = new SelectRenderable(renderer, {
  id: 'choice',
  height: 3,
  selectedIndex: 0,
  showDescription: false,
  options: [
    { name: 'Draft', description: 'Keep editing' },
    { name: 'Ready', description: 'Ready to approve' },
    { name: 'Sent', description: 'Already submitted' },
  ],
});
const table = new TextTableRenderable(renderer, {
  id: 'summary',
  height: 4,
  content: [
    [[white('Task')], [white('Status')]],
    [[white('Review')], [white('Pending')]],
  ],
});
const log = new ScrollBoxRenderable(renderer, {
  id: 'activity-log',
  height: 4,
  scrollY: true,
  scrollX: false,
  stickyScroll: false,
});

for (let line = 1; line <= 10; line += 1) {
  log.add(
    new TextRenderable(renderer, {
      id: `activity-${line}`,
      content: `Activity ${line}`,
      height: 1,
    }),
  );
}

panel.add(label);
panel.add(field);
panel.add(choice);
panel.add(table);
panel.add(log);
renderer.root.add(panel);
renderer.start();

let step = 0;
const tick = (): void => {
  step += 1;
  if (step > steps) {
    renderer.destroy();
    process.stdout.write('', () => {
      if (process.env['TW_WRAP_STDOUT_WRITE'] === '1') {
        writeSync(
          3,
          `${JSON.stringify({
            wrapperRestoredAfterDestroy: process.stdout.write === wrappedWrite,
            wrappedWriteCalls,
          })}\n`,
        );
      }
      process.exit(0);
    });
    return;
  }
  // Things an application would plausibly do: edit, change the highlighted
  // item, and follow a growing activity log.
  field.value = `typed ${step}`;
  label.content = `Approve ${step}`;
  choice.setSelectedIndex(step % choice.options.length);
  log.scrollTo(step);
  setTimeout(tick, 120);
};

setTimeout(tick, 120);
