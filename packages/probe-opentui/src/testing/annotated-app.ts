/** Ordinary OpenTUI ownership plus an optional annotation on a custom Renderable. */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { describeRenderable } from '@termwright/opentui';

class DeploymentRenderable extends BoxRenderable {}

const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
const label = new TextRenderable(renderer, { id: 'deploy-label', content: 'Target', height: 1 });
const deployment = new DeploymentRenderable(renderer, {
  id: 'deployment',
  width: 24,
  height: 3,
  border: true,
});
deployment.add(new TextRenderable(renderer, { content: 'Physical label', height: 1 }));

describeRenderable(label, { role: 'text', name: 'Deployment target', testId: 'deploy-label' });
describeRenderable(deployment, {
  role: 'button',
  name: 'Deploy production',
  description: 'Starts the production deployment',
  testId: 'deploy-production',
  extended: { environment: 'production', retries: 2 },
  actions: ['activate'],
  labelledBy: [label],
  describedBy: [label],
});

renderer.root.add(label);
renderer.root.add(deployment);
renderer.start();
setTimeout(() => {
  renderer.destroy();
  process.stdout.write('', () => process.exit(0));
}, 300);
