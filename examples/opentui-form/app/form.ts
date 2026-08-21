import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
} from '@opentui/core';

const renderer = await createCliRenderer({exitOnCtrlC: true, targetFps: 30});
const form = new BoxRenderable(renderer, {
  id: 'release-form',
  border: true,
  width: 44,
  height: 8,
  flexDirection: 'column',
});
const heading = new TextRenderable(renderer, {
  id: 'heading',
  content: 'Create release',
  height: 1,
});
const name = new InputRenderable(renderer, {
  id: 'release-name',
  placeholder: 'Release name',
});
const status = new TextRenderable(renderer, {
  id: 'status',
  content: 'status: editing',
  height: 1,
});

name.on(InputRenderableEvents.ENTER, () => {
  status.content = `status: created ${name.value}`;
});

form.add(heading);
form.add(name);
form.add(status);
renderer.root.add(form);
renderer.start();
name.focus();
