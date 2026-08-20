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

const steps = Number(process.env['TW_APP_STEPS'] ?? 2);

const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });

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
  log.add(new TextRenderable(renderer, {
    id: `activity-${line}`,
    content: `Activity ${line}`,
    height: 1,
  }));
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
    process.stdout.write('', () => process.exit(0));
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
