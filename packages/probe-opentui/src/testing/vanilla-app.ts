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

import { createCliRenderer, BoxRenderable, TextRenderable, InputRenderable } from '@opentui/core';

const steps = Number(process.env['TW_APP_STEPS'] ?? 2);

const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });

const panel = new BoxRenderable(renderer, { id: 'panel', border: true });
const label = new TextRenderable(renderer, { id: 'label', content: 'Approve' });
const field = new InputRenderable(renderer, { id: 'field', value: '' });

panel.add(label);
panel.add(field);
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
  // Something an application would plausibly do: change a value and a label.
  field.value = `typed ${step}`;
  label.content = `Approve ${step}`;
  setTimeout(tick, 120);
};

setTimeout(tick, 120);
